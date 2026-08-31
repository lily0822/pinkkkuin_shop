import type { CartItem } from "@/components/cart-provider";

export type ShippingMethod = "convenience_store" | "home_delivery" | "meetup" | "";
export type PaymentMethod = "pending" | "";

export type CheckoutForm = {
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  sameAsCustomer: boolean;
  recipientName: string;
  recipientPhone: string;
  shippingMethod: ShippingMethod;
  postalCode: string;
  shippingAddress: string;
  meetupConfirmed: boolean;
  paymentMethod: PaymentMethod;
  note: string;
};

export type CheckoutItem = {
  productId: string;
  productName: string;
  variantId: string | null;
  variantSpec: string | null;
  unitPrice: number;
  quantity: number;
  subtotal: number;
  image?: string;
  productType: string;
};

export type CheckoutOrderDraft = {
  customer: {
    name: string;
    phone: string;
    email: string;
  };
  recipient: {
    name: string;
    phone: string;
  };
  shipping: {
    method: ShippingMethod;
    postalCode?: string;
    address?: string;
    meetupConfirmed?: boolean;
    fee: number;
    status: "not_started";
  };
  payment: {
    method: PaymentMethod;
    status: "not_started";
  };
  amounts: {
    subtotal: number;
    discountAmount: number;
    shippingFee: number;
    totalAmount: number;
  };
  items: CheckoutItem[];
  note?: string;
};

export function cartItemsToCheckoutItems(items: CartItem[]): CheckoutItem[] {
  return items.map((item) => ({
    productId: item.productId,
    productName: item.productName,
    variantId: item.variantId,
    variantSpec: item.variantSpec,
    unitPrice: Math.round(Number(item.unitPrice || 0)),
    quantity: Math.max(1, Math.floor(Number(item.quantity || 1))),
    subtotal: Math.round(Number(item.unitPrice || 0)) * Math.max(1, Math.floor(Number(item.quantity || 1))),
    image: item.image,
    productType: item.productType,
  }));
}

export function createCheckoutDraft(form: CheckoutForm, items: CartItem[]): CheckoutOrderDraft {
  const checkoutItems = cartItemsToCheckoutItems(items);
  const subtotal = checkoutItems.reduce((sum, item) => sum + item.subtotal, 0);
  const shippingFee = 0;
  const discountAmount = 0;

  return {
    customer: {
      name: form.customerName.trim(),
      phone: form.customerPhone.trim(),
      email: form.customerEmail.trim(),
    },
    recipient: {
      name: form.recipientName.trim(),
      phone: form.recipientPhone.trim(),
    },
    shipping: {
      method: form.shippingMethod,
      postalCode: form.shippingMethod === "home_delivery" ? form.postalCode.trim() || undefined : undefined,
      address: form.shippingMethod === "home_delivery" ? form.shippingAddress.trim() || undefined : undefined,
      meetupConfirmed: form.shippingMethod === "meetup" ? form.meetupConfirmed : undefined,
      fee: shippingFee,
      status: "not_started",
    },
    payment: {
      method: form.paymentMethod,
      status: "not_started",
    },
    amounts: {
      subtotal,
      discountAmount,
      shippingFee,
      totalAmount: subtotal - discountAmount + shippingFee,
    },
    items: checkoutItems,
    note: form.note.trim() || undefined,
  };
}
