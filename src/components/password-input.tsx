"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

export function PasswordInput({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="block text-sm font-black text-penguin-gray">
      {label}
      <div className="relative mt-2">
        <input
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-12 w-full rounded-2xl border-2 border-penguin-peach bg-white px-4 pr-12 text-sm font-bold outline-none transition focus:border-penguin-pink"
          required
        />
        <button
          type="button"
          onClick={() => setVisible((prev) => !prev)}
          aria-label={visible ? "隱藏密碼" : "顯示密碼"}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition hover:text-penguin-pink-dark"
        >
          {visible ? <Eye size={18} /> : <EyeOff size={18} />}
        </button>
      </div>
    </label>
  );
}
