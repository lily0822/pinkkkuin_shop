"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ShoppingBasket } from "lucide-react";
import { useCart } from "@/components/cart-provider";
import { CheckoutForm, createCheckoutDraft, ShippingMethod } from "@/lib/checkout";
import { formatPrice } from "@/lib/products";

const initialForm: CheckoutForm = {
  customerName: "",
  customerPhone: "",
  customerEmail: "",
  sameAsCustomer: true,
  recipientName: "",
  recipientPhone: "",
  shippingMethod: "",
  postalCode: "",
  shippingAddress: "",
  meetupConfirmed: false,
  paymentMethod: "pending",
  note: "",
};

function isTaiwanMobile(value: string) {
  return /^09\d{8}$/.test(value.trim());
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs font-bold text-red-500">{message}</p>;
}

function Separator() {
  return <div className="mx-2 border-t-2 border-dashed border-penguin-pink/35" aria-hidden="true" />;
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-black text-penguin-gray">{title}</h2>
      {children}
    </section>
  );
}

function TextInput({
  label,
  value,
  onChange,
  error,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm font-black text-penguin-gray">
      {label}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={`mt-2 h-12 w-full rounded-2xl border-2 bg-white px-4 text-sm font-bold text-penguin-gray outline-none transition placeholder:text-gray-300 ${
          error ? "border-red-300 focus:border-red-400" : "border-penguin-peach focus:border-penguin-pink"
        }`}
      />
      <FieldError message={error} />
    </label>
  );
}

export function CheckoutClient() {
  const router = useRouter();
  const { items, selectedItems, selectedLineCount, clearSelectedItems } = useCart();
  const [form, setForm] = useState<CheckoutForm>(initialForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const draft = useMemo(() => createCheckoutDraft(form, selectedItems), [form, selectedItems]);
  const selectedHasPreorder = selectedItems.some((item) => item.productTypeKey === "preorder");
  const meetupAvailable = selectedLineCount > 0 && !selectedHasPreorder;

  useEffect(() => {
    if (!meetupAvailable && form.shippingMethod === "meetup") {
      setForm((current) => ({
        ...current,
        shippingMethod: "",
        meetupConfirmed: false,
      }));
      setErrors((current) => ({
        ...current,
        shippingMethod: "",
        meetupConfirmed: "",
      }));
    }
  }, [form.shippingMethod, meetupAvailable]);

  function update<K extends keyof CheckoutForm>(key: K, value: CheckoutForm[K]) {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if ((key === "customerName" || key === "customerPhone" || key === "sameAsCustomer") && next.sameAsCustomer) {
        next.recipientName = next.customerName;
        next.recipientPhone = next.customerPhone;
      }
      return next;
    });
    setSubmitError("");
    setErrors((current) => ({ ...current, [key]: "" }));
  }

  function selectShippingMethod(method: ShippingMethod) {
    if (method === "meetup" && !meetupAvailable) return;
    setForm((current) => ({
      ...current,
      shippingMethod: method,
      postalCode: method === "home_delivery" ? current.postalCode : "",
      shippingAddress: method === "home_delivery" ? current.shippingAddress : "",
      meetupConfirmed: method === "meetup" ? current.meetupConfirmed : false,
    }));
    setSubmitError("");
    setErrors((current) => ({
      ...current,
      shippingMethod: "",
      shippingAddress: "",
      meetupConfirmed: "",
    }));
  }

  function validate() {
    const nextErrors: Record<string, string> = {};
    if (!selectedLineCount) nextErrors.cart = "請至少選擇一件要結帳的商品。";
    if (!form.customerName.trim()) nextErrors.customerName = "請填寫姓名";
    if (!isTaiwanMobile(form.customerPhone)) nextErrors.customerPhone = "請填寫 09 開頭的 10 碼手機";
    if (!isEmail(form.customerEmail)) nextErrors.customerEmail = "請填寫正確 Email";
    if (!form.recipientName.trim()) nextErrors.recipientName = "請填寫收件人姓名";
    if (!isTaiwanMobile(form.recipientPhone)) nextErrors.recipientPhone = "請填寫 09 開頭的 10 碼手機";
    if (!form.shippingMethod) nextErrors.shippingMethod = "請選擇配送方式";
    if (form.shippingMethod === "home_delivery" && !form.shippingAddress.trim()) nextErrors.shippingAddress = "請填寫宅配地址";
    if (form.shippingMethod === "convenience_store") nextErrors.shippingMethod = "門市選擇功能尚未啟用，暫時不能送出 7-11 訂單";
    if (form.shippingMethod === "meetup" && selectedHasPreorder) nextErrors.shippingMethod = "本次結帳含預購商品，無法使用面交。";
    if (form.shippingMethod === "meetup" && !form.meetupConfirmed) nextErrors.meetupConfirmed = "請先確認 LINE 面交，再勾選確認。";
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError("");
    if (!validate() || submitting) return;

    setSubmitting(true);
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const result = await response.json().catch(() => null) as {
        ok?: boolean;
        error?: string;
        checkoutGroupId?: string | null;
        orders?: Array<{ orderNo?: string; orderType?: string; total?: number; paymentStatus?: string; shippingStatus?: string }>;
        order?: { orderNo?: string; orderType?: string; total?: number; paymentStatus?: string; shippingStatus?: string };
      } | null;
      const createdOrders = Array.isArray(result?.orders) && result.orders.length
        ? result.orders
        : result?.order
          ? [result.order]
          : [];
      if (!response.ok || !result?.ok || !createdOrders.some((order) => order.orderNo)) {
        throw new Error(result?.error || "訂單建立失敗，請稍後再試。");
      }

      clearSelectedItems();
      const totalAmount = createdOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
      const params = new URLSearchParams({
        orderNos: createdOrders.map((order) => order.orderNo).filter(Boolean).join(","),
        orders: JSON.stringify(createdOrders.map((order) => ({
          orderNo: order.orderNo || "",
          orderType: order.orderType || "",
          total: Number(order.total || 0),
        }))),
        total: String(totalAmount || draft.amounts.totalAmount),
        paymentStatus: createdOrders[0]?.paymentStatus || "pending",
        shippingStatus: createdOrders[0]?.shippingStatus || "pending",
        shippingMethod: draft.shipping.method,
      });
      if (result.checkoutGroupId) params.set("checkoutGroupId", result.checkoutGroupId);
      router.push(`/order-success?${params.toString()}`);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "訂單建立失敗，請稍後再試。");
      setSubmitting(false);
    }
  }

  if (!items.length || !selectedLineCount) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <section className="rounded-3xl border-2 border-penguin-peach bg-white p-8 text-center shadow-sm">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-penguin-pink-light text-penguin-pink-dark">
            <ShoppingBasket size={26} />
          </div>
          <h1 className="mt-5 text-2xl font-black text-penguin-gray">{items.length ? "尚未選擇結帳商品" : "購物車是空的"}</h1>
          <p className="mt-2 text-sm font-bold text-gray-500">{items.length ? "請回到購物車勾選這次要結帳的商品。" : "請先挑選商品，再回來填寫結帳資料。"}</p>
          <Link href="/products" className="mt-6 inline-flex h-11 items-center rounded-full bg-penguin-pink-dark px-6 text-sm font-black text-white shadow-md">
            {items.length ? "回到商品列表" : "前往商品列表"}
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <p className="text-xs font-black text-penguin-pink-dark">結帳流程</p>
        <h1 className="mt-1 text-3xl font-black text-penguin-gray sm:text-4xl">結帳</h1>
        <p className="mt-2 text-sm font-bold text-gray-500">目前為測試結帳，不會串接正式付款或物流。</p>
      </div>

      <form className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]" onSubmit={handleSubmit}>
        <section className="space-y-6 rounded-3xl border-2 border-penguin-peach bg-white/95 p-5 shadow-sm sm:p-7">
          <FormSection title="聯絡資料">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput label="姓名" value={form.customerName} onChange={(value) => update("customerName", value)} error={errors.customerName} placeholder="請輸入姓名" />
              <TextInput label="手機" value={form.customerPhone} onChange={(value) => update("customerPhone", value)} error={errors.customerPhone} placeholder="0912345678" />
              <div className="sm:col-span-2">
                <TextInput label="Email" type="email" value={form.customerEmail} onChange={(value) => update("customerEmail", value)} error={errors.customerEmail} placeholder="hello@example.com" />
              </div>
            </div>
          </FormSection>

          <Separator />

          <FormSection title="收件資料">
            <div className="flex justify-end">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-penguin-pink-light px-3 py-1.5 text-xs font-black text-penguin-gray">
                <input
                  type="checkbox"
                  checked={form.sameAsCustomer}
                  onChange={(event) => update("sameAsCustomer", event.target.checked)}
                  className="h-4 w-4 accent-penguin-pink-dark"
                />
                同聯絡人
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput label="收件人姓名" value={form.recipientName} onChange={(value) => update("recipientName", value)} error={errors.recipientName} />
              <TextInput label="收件人手機" value={form.recipientPhone} onChange={(value) => update("recipientPhone", value)} error={errors.recipientPhone} />
            </div>
          </FormSection>

          <Separator />

          <FormSection title="配送方式">
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { value: "home_delivery", label: "宅配", note: "目前運費暫以 NT$0 試算" },
                { value: "convenience_store", label: "7-11 超商取貨", note: "門市選擇功能尚未啟用" },
                {
                  value: "meetup",
                  label: "面交",
                  note: meetupAvailable ? "請先透過 LINE 確認面交時間與地點" : "本次結帳含預購商品，無法使用面交。",
                  disabled: !meetupAvailable,
                },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={option.disabled}
                  onClick={() => selectShippingMethod(option.value as ShippingMethod)}
                  className={`rounded-2xl border-2 p-4 text-left transition ${
                    form.shippingMethod === option.value
                      ? "border-penguin-pink-dark bg-penguin-pink-light"
                      : option.disabled
                        ? "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400 opacity-70"
                        : "border-penguin-peach bg-white hover:border-penguin-pink"
                  }`}
                >
                  <span className={`block text-sm font-black ${option.disabled ? "text-gray-400" : "text-penguin-gray"}`}>{option.label}</span>
                  <span className={`mt-1 block text-xs font-bold ${option.disabled ? "text-gray-400" : "text-gray-500"}`}>{option.note}</span>
                </button>
              ))}
            </div>
            <FieldError message={errors.shippingMethod} />

            {form.shippingMethod === "convenience_store" ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-700">
                門市選擇功能尚未啟用。下一階段串接物流前，不會建立正式超商取貨訂單。
              </div>
            ) : null}

            {form.shippingMethod === "home_delivery" ? (
              <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
                <TextInput label="郵遞區號（可選）" value={form.postalCode} onChange={(value) => update("postalCode", value.replace(/[^\d]/g, ""))} />
                <TextInput label="地址" value={form.shippingAddress} onChange={(value) => update("shippingAddress", value)} error={errors.shippingAddress} placeholder="請輸入完整地址" />
              </div>
            ) : null}

            {form.shippingMethod === "meetup" ? (
              <div className="space-y-3 rounded-2xl border border-penguin-pink/40 bg-penguin-pink-light/60 p-4 text-sm font-bold leading-6 text-penguin-gray">
                <p>面交不會自動預約地點或時間，請先透過 LINE 與小企鵝確認後再送出訂單。</p>
                <label className="inline-flex cursor-pointer items-start gap-2 text-sm font-black text-penguin-gray">
                  <input
                    type="checkbox"
                    checked={form.meetupConfirmed}
                    onChange={(event) => update("meetupConfirmed", event.target.checked)}
                    className="mt-1 h-4 w-4 shrink-0 accent-penguin-pink-dark"
                  />
                  我已經透過 LINE 確認面交方式
                </label>
                <FieldError message={errors.meetupConfirmed} />
              </div>
            ) : null}
          </FormSection>

          <Separator />

          <FormSection title="付款方式">
            <div className="rounded-2xl border border-penguin-peach bg-penguin-cream/70 p-4 text-sm font-bold leading-6 text-gray-600">
              測試階段，尚未啟用付款。信用卡與 LINE Pay 將於正式上線前串接。
            </div>
          </FormSection>

          <Separator />

          <FormSection title="備註">
            <textarea
              value={form.note}
              onChange={(event) => update("note", event.target.value)}
              rows={4}
              className="w-full rounded-2xl border-2 border-penguin-peach bg-white px-4 py-3 text-sm font-bold text-penguin-gray outline-none transition focus:border-penguin-pink"
              placeholder="有需要提醒小企鵝的事情可以寫在這裡"
            />
          </FormSection>
        </section>

        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="rounded-3xl border-2 border-penguin-peach bg-white p-5 shadow-xl">
            <h2 className="text-lg font-black text-penguin-gray">訂單摘要</h2>
            <div className="mt-4 space-y-4">
              {draft.items.map((item) => (
                <div key={`${item.productId}:${item.variantId || "base"}`} className="flex gap-3 border-b border-penguin-peach/70 pb-4 last:border-b-0">
                  <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-penguin-pink-light text-xl font-black text-penguin-pink-dark">
                    {item.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.image} alt={item.productName} className="h-full w-full object-cover" />
                    ) : "P"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-black leading-5 text-penguin-gray">{item.productName}</p>
                    {item.variantSpec ? <p className="mt-1 text-xs font-black text-penguin-pink-dark">規格：{item.variantSpec}</p> : null}
                    <p className="mt-1 text-xs font-bold text-gray-500">{formatPrice(item.unitPrice)} × {item.quantity}</p>
                  </div>
                  <p className="shrink-0 text-sm font-black text-penguin-gray">{formatPrice(item.subtotal)}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 space-y-2 border-t border-penguin-peach pt-4 text-sm font-bold text-gray-500">
              <div className="flex justify-between gap-4">
                <span>商品小計</span>
                <span>{formatPrice(draft.amounts.subtotal)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>運費</span>
                <span>{formatPrice(draft.amounts.shippingFee)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>優惠</span>
                <span>-{formatPrice(draft.amounts.discountAmount)}</span>
              </div>
              <div className="flex justify-between gap-4 border-t border-penguin-peach pt-3 text-lg font-black text-penguin-gray">
                <span>總計</span>
                <span className="text-penguin-pink-dark">{formatPrice(draft.amounts.totalAmount)}</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="mt-5 h-12 w-full rounded-full bg-penguin-pink-dark px-5 text-sm font-black text-white shadow-md transition hover:bg-penguin-pink disabled:cursor-wait disabled:bg-gray-300"
            >
              {submitting ? "建立訂單中..." : "送出訂單"}
            </button>
            {errors.cart ? <FieldError message={errors.cart} /> : null}
            {submitError ? (
              <p className="mt-3 rounded-2xl bg-red-50 px-3 py-2 text-xs font-black leading-5 text-red-600">{submitError}</p>
            ) : (
              <p className="mt-3 flex items-start gap-2 text-xs font-bold leading-5 text-gray-400">
                <AlertCircle className="mt-0.5 shrink-0" size={14} />
                付款與物流仍是測試階段。送出後會建立待付款訂單。
              </p>
            )}
          </div>
        </aside>
      </form>
    </main>
  );
}
