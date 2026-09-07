"use client";

import { FormEvent, useEffect, useState } from "react";
import { Check, Pencil, Plus, Star, Trash2, X } from "lucide-react";

type MemberProfile = {
  displayName: string;
  phone: string;
  status: string;
};

type MemberAddress = {
  id: string;
  recipientName: string;
  phone: string;
  postalCode: string;
  city: string;
  district: string;
  addressLine: string;
  isDefault: boolean;
};

type AddressForm = Omit<MemberAddress, "id">;

type MemberProfileManagerProps = {
  email: string;
  emailVerified: boolean;
  initialProfile: MemberProfile | null;
  initialAddresses: MemberAddress[];
};

const emptyAddress: AddressForm = {
  recipientName: "",
  phone: "",
  postalCode: "",
  city: "",
  district: "",
  addressLine: "",
  isDefault: false,
};

function TextInput({ label, value, onChange, placeholder }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm font-black text-penguin-gray">
      {label}
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-11 w-full rounded-2xl border-2 border-penguin-peach bg-white px-4 text-sm font-bold text-penguin-gray outline-none transition placeholder:text-gray-300 focus:border-penguin-pink"
      />
    </label>
  );
}

export function MemberProfileManager({ email, emailVerified, initialProfile, initialAddresses }: MemberProfileManagerProps) {
  const [displayName, setDisplayName] = useState(initialProfile?.displayName || "");
  const [phone, setPhone] = useState(initialProfile?.phone || "");
  const [addresses, setAddresses] = useState<MemberAddress[]>(initialAddresses);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addressForm, setAddressForm] = useState<AddressForm>(emptyAddress);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDisplayName(initialProfile?.displayName || "");
    setPhone(initialProfile?.phone || "");
    setAddresses(initialAddresses);
  }, [initialProfile, initialAddresses]);

  function showMessage(value: string) {
    setMessage(value);
    setError("");
  }

  function showError(value: string) {
    setError(value);
    setMessage("");
  }

  async function reloadAddresses() {
    const response = await fetch("/api/member/addresses", { cache: "no-store" });
    const result = await response.json().catch(() => null) as { ok?: boolean; addresses?: MemberAddress[]; error?: string } | null;
    if (!response.ok || !result?.ok) throw new Error(result?.error || "地址資料讀取失敗。");
    setAddresses(result.addresses || []);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/member/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, phone }),
      });
      const result = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !result?.ok) throw new Error(result?.error || "會員資料儲存失敗。");
      showMessage("會員資料已更新。");
    } catch (saveError) {
      showError(saveError instanceof Error ? saveError.message : "會員資料儲存失敗。");
    } finally {
      setBusy(false);
    }
  }

  function startNewAddress() {
    setEditingId("");
    setAddressForm(emptyAddress);
    setMessage("");
    setError("");
  }

  function startEditAddress(address: MemberAddress) {
    setEditingId(address.id);
    setAddressForm({
      recipientName: address.recipientName,
      phone: address.phone,
      postalCode: address.postalCode,
      city: address.city,
      district: address.district,
      addressLine: address.addressLine,
      isDefault: address.isDefault,
    });
    setMessage("");
    setError("");
  }

  function cancelAddressEdit() {
    setEditingId(null);
    setAddressForm(emptyAddress);
  }

  async function saveAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || editingId === null) return;
    setBusy(true);
    try {
      const isCreate = editingId === "";
      const response = await fetch(isCreate ? "/api/member/addresses" : `/api/member/addresses/${editingId}`, {
        method: isCreate ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addressForm),
      });
      const result = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !result?.ok) throw new Error(result?.error || "地址資料儲存失敗。");
      await reloadAddresses();
      cancelAddressEdit();
      showMessage("地址資料已更新。");
    } catch (saveError) {
      showError(saveError instanceof Error ? saveError.message : "地址資料儲存失敗。");
    } finally {
      setBusy(false);
    }
  }

  async function deleteAddress(addressId: string) {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/member/addresses/${addressId}`, { method: "DELETE" });
      const result = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !result?.ok) throw new Error(result?.error || "地址資料刪除失敗。");
      setAddresses((current) => current.filter((item) => item.id !== addressId));
      if (editingId === addressId) cancelAddressEdit();
      showMessage("地址已刪除。");
    } catch (deleteError) {
      showError(deleteError instanceof Error ? deleteError.message : "地址資料刪除失敗。");
    } finally {
      setBusy(false);
    }
  }

  async function setDefaultAddress(address: MemberAddress) {
    if (busy || address.isDefault) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/member/addresses/${address.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...address, isDefault: true }),
      });
      const result = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !result?.ok) throw new Error(result?.error || "預設地址設定失敗。");
      await reloadAddresses();
      showMessage("已設為預設地址。");
    } catch (defaultError) {
      showError(defaultError instanceof Error ? defaultError.message : "預設地址設定失敗。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 space-y-8">
      {message ? <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{message}</p> : null}
      {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-600">{error}</p> : null}

      <section className="rounded-[24px] border-2 border-penguin-peach bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-black text-penguin-gray">基本資料</h2>
            <p className="text-sm font-bold text-gray-500">Email 由登入帳號提供，目前不可在這裡修改。</p>
          </div>
          <span className={`w-fit rounded-full px-3 py-1 text-xs font-black ${emailVerified ? "bg-emerald-50 text-emerald-700" : "bg-yellow-50 text-yellow-700"}`}>
            {emailVerified ? "Email 已驗證" : "Email 尚未驗證"}
          </span>
        </div>

        <dl className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl bg-penguin-pink-light/60 p-4">
            <dt className="text-xs font-black text-gray-500">Email</dt>
            <dd className="mt-1 break-all text-sm font-black text-penguin-gray">{email || "未提供"}</dd>
          </div>
        </dl>

        <form onSubmit={saveProfile} className="mt-5 grid gap-4 sm:grid-cols-2">
          <TextInput label="顯示名稱" value={displayName} onChange={setDisplayName} placeholder="想讓我們怎麼稱呼你" />
          <TextInput label="電話" value={phone} onChange={setPhone} placeholder="例如 0912345678" />
          <div className="sm:col-span-2">
            <button type="submit" disabled={busy} className="rounded-full bg-penguin-pink-dark px-6 py-3 text-sm font-black text-white shadow-md disabled:opacity-60">
              儲存基本資料
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-[24px] border-2 border-penguin-peach bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-black text-penguin-gray">地址管理</h2>
            <p className="text-sm font-bold text-gray-500">可先建立常用收件地址，之後結帳會更方便。</p>
          </div>
          <button type="button" onClick={startNewAddress} className="inline-flex w-fit items-center gap-2 rounded-full bg-penguin-pink-dark px-5 py-2.5 text-sm font-black text-white shadow-md">
            <Plus size={16} />
            新增地址
          </button>
        </div>

        {editingId !== null ? (
          <form onSubmit={saveAddress} className="mt-5 rounded-2xl bg-penguin-cream p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput label="收件人姓名" value={addressForm.recipientName} onChange={(value) => setAddressForm((current) => ({ ...current, recipientName: value }))} />
              <TextInput label="收件人電話" value={addressForm.phone} onChange={(value) => setAddressForm((current) => ({ ...current, phone: value }))} />
              <TextInput label="郵遞區號" value={addressForm.postalCode} onChange={(value) => setAddressForm((current) => ({ ...current, postalCode: value }))} />
              <TextInput label="縣市" value={addressForm.city} onChange={(value) => setAddressForm((current) => ({ ...current, city: value }))} />
              <TextInput label="鄉鎮市區" value={addressForm.district} onChange={(value) => setAddressForm((current) => ({ ...current, district: value }))} />
              <TextInput label="詳細地址" value={addressForm.addressLine} onChange={(value) => setAddressForm((current) => ({ ...current, addressLine: value }))} />
            </div>
            <label className="mt-4 flex w-fit items-center gap-2 text-sm font-black text-penguin-gray">
              <input type="checkbox" checked={addressForm.isDefault} onChange={(event) => setAddressForm((current) => ({ ...current, isDefault: event.target.checked }))} className="h-4 w-4 accent-penguin-pink-dark" />
              設為預設地址
            </label>
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-full bg-penguin-pink-dark px-5 py-2.5 text-sm font-black text-white disabled:opacity-60">
                <Check size={16} />
                儲存地址
              </button>
              <button type="button" onClick={cancelAddressEdit} className="inline-flex items-center gap-2 rounded-full border-2 border-penguin-peach bg-white px-5 py-2.5 text-sm font-black text-penguin-gray">
                <X size={16} />
                取消
              </button>
            </div>
          </form>
        ) : null}

        <div className="mt-5 space-y-3">
          {addresses.length ? addresses.map((address) => (
            <article key={address.id} className="rounded-2xl border border-penguin-peach bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-black text-penguin-gray">{address.recipientName}</h3>
                    {address.isDefault ? <span className="rounded-full bg-penguin-yellow px-2.5 py-1 text-xs font-black text-penguin-gray">預設</span> : null}
                  </div>
                  <p className="mt-1 text-sm font-bold text-gray-500">{address.phone}</p>
                  <p className="mt-1 text-sm font-bold text-penguin-gray">{address.postalCode} {address.city}{address.district}{address.addressLine}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setDefaultAddress(address)} disabled={busy || address.isDefault} className="inline-flex items-center gap-1 rounded-full border border-penguin-peach px-3 py-2 text-xs font-black text-penguin-gray disabled:opacity-50">
                    <Star size={14} />
                    設預設
                  </button>
                  <button type="button" onClick={() => startEditAddress(address)} className="inline-flex items-center gap-1 rounded-full border border-penguin-peach px-3 py-2 text-xs font-black text-penguin-gray">
                    <Pencil size={14} />
                    編輯
                  </button>
                  <button type="button" onClick={() => deleteAddress(address.id)} disabled={busy} className="inline-flex items-center gap-1 rounded-full border border-red-100 px-3 py-2 text-xs font-black text-red-500 disabled:opacity-50">
                    <Trash2 size={14} />
                    刪除
                  </button>
                </div>
              </div>
            </article>
          )) : (
            <p className="rounded-2xl bg-penguin-pink-light/50 px-4 py-5 text-center text-sm font-bold text-gray-500">目前還沒有常用地址。</p>
          )}
        </div>
      </section>
    </div>
  );
}
