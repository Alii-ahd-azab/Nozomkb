"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SPECIALTY_MAX_LENGTH } from "@/lib/definitions";
import { AR } from "@/lib/messages";

export default function SpecialtyForm({
  initialSpecialty,
}: {
  initialSpecialty: string;
}) {
  const router = useRouter();
  const [specialty, setSpecialty] = useState(initialSpecialty);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (specialty.trim().length > SPECIALTY_MAX_LENGTH) {
      setError(AR.specialtyTooLong);
      return;
    }

    setIsSaving(true);
    setError("");
    setMessage("");

    try {
      // Only "specialty" is sent; the API rejects any other field.
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ specialty }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error || AR.profileFailed);
        return;
      }

      setMessage("Specialty saved.");
      router.refresh();
    } catch {
      setError(AR.profileFailed);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="post-form" onSubmit={handleSubmit}>
      <label htmlFor="specialty">Specialty</label>
      <input
        id="specialty"
        type="text"
        value={specialty}
        maxLength={SPECIALTY_MAX_LENGTH}
        placeholder="e.g. Network support, Payroll, Financial reporting"
        onChange={(event) => setSpecialty(event.target.value)}
      />

      {error && (
        <p className="form-error" role="alert" dir="rtl">
          {error}
        </p>
      )}
      {message && <p className="form-success">{message}</p>}

      <button type="submit" className="btn btn-primary" disabled={isSaving}>
        {isSaving ? "Saving..." : "Save Specialty"}
      </button>
    </form>
  );
}
