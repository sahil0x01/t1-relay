"use client";

import Link from "next/link";
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

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const data = new FormData(event.currentTarget);
    const result = await authClient.requestPasswordReset({
      email: String(data.get("email")),
      redirectTo: "/reset-password",
    });

    setPending(false);
    if (result.error) {
      setError("Something went wrong. Try again.");
      return;
    }
    setSent(true);
  }

  return (
    <AuthCard
      title="Reset your password"
      description="Enter your email and we will send you a link to choose a new password."
    >
      {sent ? (
        <p className="text-sm">
          If an account exists for that email, a reset link is on its way.
        </p>
      ) : (
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input id="email" name="email" type="email" required />
            </Field>
            {error && <FieldError>{error}</FieldError>}
            <Button type="submit" disabled={pending}>
              {pending ? "Sending..." : "Send reset link"}
            </Button>
          </FieldGroup>
        </form>
      )}

      <p className="text-sm text-muted-foreground">
        <Link href="/login" className="underline">
          Back to log in
        </Link>
      </p>
    </AuthCard>
  );
}
