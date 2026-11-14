"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthCard } from "@/components/auth-card";
import { Button } from "@/components/ui/button";

export default function VerifyEmailPage() {
  const [resent, setResent] = useState(false);

  return (
    <AuthCard
      title="Check your inbox"
      description="If that email can be used for a new account, we sent a verification link. Open it to finish creating your account."
    >
      <Button variant="outline" onClick={() => setResent(true)}>
        Resend email
      </Button>
      {resent && (
        <p className="text-sm text-muted-foreground">
          Mock: a new email was sent.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Verified already?{" "}
        <Link href="/login" className="underline">
          Log in
        </Link>
      </p>
    </AuthCard>
  );
}
