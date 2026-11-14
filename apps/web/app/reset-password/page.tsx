"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type SubmitEvent, useState } from "react";
import { AuthCard } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

const INVALID_LINK =
  "This reset link is invalid or has expired. Request a new one.";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password"));

    if (password !== data.get("confirm")) {
      setError("Passwords do not match.");
      return;
    }

    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setError(INVALID_LINK);
      return;
    }

    setError(null);
    setPending(true);
    const result = await authClient.resetPassword({
      newPassword: password,
      token,
    });
    setPending(false);

    if (result.error) {
      setError(INVALID_LINK);
      return;
    }
    router.push("/login");
  }

  return (
    <AuthCard
      title="Choose a new password"
      description="Use at least 8 characters."
    >
      <form onSubmit={handleSubmit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="password">New password</FieldLabel>
            <Input
              id="password"
              name="password"
              type="password"
              minLength={8}
              required
            />
          </Field>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="confirm">Confirm password</FieldLabel>
            <Input
              id="confirm"
              name="confirm"
              type="password"
              required
              aria-invalid={error ? true : undefined}
            />
            {error && <FieldError>{error}</FieldError>}
          </Field>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving..." : "Set new password"}
          </Button>
        </FieldGroup>
      </form>

      <p className="text-sm text-muted-foreground">
        <Link href="/forgot-password" className="underline">
          Request a new link
        </Link>
      </p>
    </AuthCard>
  );
}
