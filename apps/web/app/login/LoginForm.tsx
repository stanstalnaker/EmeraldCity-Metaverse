"use client";

import { useActionState } from "react";
import { login, type FormState } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState<FormState, FormData>(login, {});
  return (
    <form action={action} className="form">
      <input type="hidden" name="next" value={next ?? ""} />
      <label>
        HubID email
        <input name="email" type="email" autoComplete="username" defaultValue={state.values?.email} required />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {state.error && <p className="error" role="alert">{state.error}</p>}
      <SubmitButton>Sign in</SubmitButton>
    </form>
  );
}
