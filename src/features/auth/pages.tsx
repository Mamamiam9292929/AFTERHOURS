import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { IconEye, IconEyeOff, IconMail } from "@/components/icons";
import { Button, ButtonLink, IconButton } from "@/components/ui/Button";
import { FormMessage, TextField } from "@/components/ui/Field";
import { PageSpinner } from "@/components/ui/Feedback";
import { t } from "@/i18n";
import { errorMessage } from "@/lib/errors";
import { siteUrl, supabase } from "@/lib/supabase";
import { email as emailRule, minLength, password as passwordRule, required, validate } from "@/lib/validation";
import { AuthLayout } from "./AuthLayout";
import { useAuth } from "./AuthProvider";
import { ContinueAfterAuth } from "./guards";
import { peekNext } from "./next";

const linkClass = "font-semibold text-fg underline decoration-line-strong underline-offset-4 hover:decoration-lime";

function PasswordField(props: { label: string; value: string; onChange: (v: string) => void; error?: string | null; hint?: string; autoComplete: string; name: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      label={props.label}
      name={props.name}
      type={visible ? "text" : "password"}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      error={props.error}
      hint={props.hint}
      autoComplete={props.autoComplete}
      required
      trailing={
        <IconButton label={visible ? t.auth.fields.hidePassword : t.auth.fields.showPassword} onClick={() => setVisible((v) => !v)} aria-pressed={visible}>
          {visible ? <IconEyeOff className="size-5 text-muted" aria-hidden /> : <IconEye className="size-5 text-muted" aria-hidden />}
        </IconButton>
      }
    />
  );
}

const confirmRedirect = () => `${siteUrl()}/auth/confirm`;

// ------------------------------------------------------------------------------------------------
export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string | null; password?: string | null }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const invitePending = peekNext()?.startsWith("/join/") ?? false;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next = { email: validate(email, required(), emailRule), password: validate(password, required()) };
    setErrors(next);
    setFormError(null);
    setInfo(null);
    if (next.email || next.password) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      setNeedsConfirmation(error.code === "email_not_confirmed");
      setFormError(errorMessage(error));
    }
    // Erfolg: PublicOnly leitet automatisch weiter, sobald die Sitzung da ist.
  }

  async function resend() {
    setBusy(true);
    const { error } = await supabase.auth.resend({ type: "signup", email: email.trim(), options: { emailRedirectTo: confirmRedirect() } });
    setBusy(false);
    if (error) setFormError(errorMessage(error));
    else {
      setFormError(null);
      setNeedsConfirmation(false);
      setInfo(t.auth.login.resent);
    }
  }

  return (
    <AuthLayout
      title={t.auth.login.title}
      intro={invitePending ? t.auth.login.invitePending : undefined}
      footer={
        <>
          {t.auth.login.noAccount}{" "}
          <Link to="/register" className={linkClass}>
            {t.auth.login.toRegister}
          </Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-5">
        <TextField label={t.auth.fields.email} name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} required />
        <PasswordField label={t.auth.fields.password} name="password" value={password} onChange={setPassword} error={errors.password} autoComplete="current-password" />
        {formError && <FormMessage>{formError}</FormMessage>}
        {info && <FormMessage tone="success">{info}</FormMessage>}
        {needsConfirmation && (
          <Button variant="secondary" block onClick={resend} disabled={busy} icon={<IconMail className="size-4" aria-hidden />}>
            {t.auth.login.resend}
          </Button>
        )}
        <Button type="submit" size="lg" block loading={busy}>
          {t.auth.login.submit}
        </Button>
        <p className="text-center text-sm">
          <Link to="/forgot-password" className={linkClass}>
            {t.auth.login.forgot}
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}

// ------------------------------------------------------------------------------------------------
export function RegisterPage() {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [errors, setErrors] = useState<{ displayName?: string | null; email?: string | null; password?: string | null; age?: string | null }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next = {
      displayName: validate(displayName, required(), minLength(2)),
      email: validate(email, required(), emailRule),
      password: validate(password, required(), passwordRule),
      age: ageConfirmed ? null : t.auth.register.ageRequired,
    };
    setErrors(next);
    setFormError(null);
    if (next.displayName || next.email || next.password || next.age) return;
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: confirmRedirect(), data: { display_name: displayName.trim() } },
    });
    setBusy(false);
    if (error) {
      setFormError(errorMessage(error));
      return;
    }
    // Mit E-Mail-Bestätigung gibt es noch keine Sitzung; ohne (lokale Entwicklung) geht es direkt weiter.
    if (!data.session) navigate(`/check-email?email=${encodeURIComponent(email.trim())}`, { replace: true });
  }

  return (
    <AuthLayout
      title={t.auth.register.title}
      footer={
        <>
          {t.auth.register.hasAccount}{" "}
          <Link to="/login" className={linkClass}>
            {t.auth.register.toLogin}
          </Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-5">
        <TextField label={t.auth.fields.displayName} name="display_name" autoComplete="nickname" maxLength={40} value={displayName} onChange={(e) => setDisplayName(e.target.value)} error={errors.displayName} hint={t.auth.fields.displayNameHint} required />
        <TextField label={t.auth.fields.email} name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} required />
        <PasswordField label={t.auth.fields.password} name="password" value={password} onChange={setPassword} error={errors.password} hint={t.auth.fields.passwordHint} autoComplete="new-password" />
        <div className="space-y-1.5">
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] text-fg">
            <input type="checkbox" name="age" checked={ageConfirmed} onChange={(e) => setAgeConfirmed(e.target.checked)} className="size-5 shrink-0 accent-[var(--color-lime)]" aria-invalid={Boolean(errors.age)} />
            {t.auth.register.ageConfirm}
          </label>
          {errors.age && (
            <p role="alert" className="text-[13px] text-danger">
              {errors.age}
            </p>
          )}
        </div>
        {formError && <FormMessage>{formError}</FormMessage>}
        <Button type="submit" size="lg" block loading={busy}>
          {t.auth.register.submit}
        </Button>
        <p className="text-[13px] leading-snug text-faint">
          {t.auth.register.privacyNote}{" "}
          <Link to="/privacy" className="underline underline-offset-2 hover:text-fg">
            {t.auth.register.privacyLink}
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}

// ------------------------------------------------------------------------------------------------
export function CheckEmailPage() {
  const [params] = useSearchParams();
  const email = params.get("email") ?? "";
  const [state, setState] = useState<{ busy: boolean; info?: string; error?: string }>({ busy: false });

  async function resend() {
    if (!email) return;
    setState({ busy: true });
    const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: confirmRedirect() } });
    setState(error ? { busy: false, error: errorMessage(error) } : { busy: false, info: t.auth.checkEmail.resent });
  }

  return (
    <AuthLayout title={t.auth.checkEmail.title} intro={email ? t.auth.checkEmail.body(email) : t.auth.checkEmail.bodyNoEmail}>
      <div className="space-y-5">
        <FormMessage tone="info">{t.auth.checkEmail.hint}</FormMessage>
        {state.info && <FormMessage tone="success">{state.info}</FormMessage>}
        {state.error && <FormMessage>{state.error}</FormMessage>}
        {email && (
          <Button variant="secondary" block onClick={resend} loading={state.busy} icon={<IconMail className="size-4" aria-hidden />}>
            {t.auth.checkEmail.resend}
          </Button>
        )}
        <ButtonLink to="/login" variant="ghost" block>
          {t.auth.checkEmail.toLogin}
        </ButtonLink>
      </div>
    </AuthLayout>
  );
}

// ------------------------------------------------------------------------------------------------
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const invalid = validate(email, required(), emailRule);
    setError(invalid);
    setFormError(null);
    if (invalid) return;
    setBusy(true);
    const { error: apiError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${siteUrl()}/auth/reset` });
    setBusy(false);
    if (apiError) setFormError(errorMessage(apiError));
    else setSent(true);
  }

  return (
    <AuthLayout
      title={t.auth.forgot.title}
      intro={t.auth.forgot.body}
      footer={
        <Link to="/login" className={linkClass}>
          {t.auth.forgot.toLogin}
        </Link>
      }
    >
      {sent ? (
        <FormMessage tone="success">{t.auth.forgot.sent}</FormMessage>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-5">
          <TextField label={t.auth.fields.email} name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} error={error} required />
          {formError && <FormMessage>{formError}</FormMessage>}
          <Button type="submit" size="lg" block loading={busy}>
            {t.auth.forgot.submit}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

// ------------------------------------------------------------------------------------------------
/**
 * Ziel der Links aus Bestätigungs-E-Mails. Unterstützt beide Supabase-Varianten:
 *   - Standardvorlage: Supabase prüft den Link selbst und leitet mit Sitzung im URL-Fragment hierher
 *     (der Client übernimmt sie automatisch, siehe detectSessionInUrl),
 *   - eigene Vorlage mit ?token_hash=…&type=… (funktioniert auch geräteübergreifend).
 */
export function AuthConfirmPage() {
  const { loading, user } = useAuth();
  const [params] = useSearchParams();
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  const [failed, setFailed] = useState(() => /error(_code)?=/.test(window.location.hash) || params.has("error"));
  const [verifying, setVerifying] = useState(Boolean(tokenHash));

  useEffect(() => {
    if (!tokenHash) return;
    let active = true;
    const otpType = type === "recovery" || type === "invite" || type === "email_change" || type === "magiclink" ? type : "email";
    void supabase.auth.verifyOtp({ token_hash: tokenHash, type: otpType }).then(({ error }) => {
      if (!active) return;
      if (error) setFailed(true);
      setVerifying(false);
    });
    return () => {
      active = false;
    };
  }, [tokenHash, type]);

  if (user && !verifying) return <ContinueAfterAuth />;
  if (loading || verifying) return <PageSpinner label={t.auth.confirm.working} />;
  if (failed || !user) {
    return (
      <AuthLayout title={t.auth.confirm.failedTitle} intro={t.auth.confirm.failedBody}>
        <ButtonLink to="/login" size="lg" block>
          {t.auth.confirm.toLogin}
        </ButtonLink>
      </AuthLayout>
    );
  }
  return <PageSpinner label={t.auth.confirm.working} />;
}

// ------------------------------------------------------------------------------------------------
/** Ziel des Links aus der Passwort-zurücksetzen-E-Mail: neues Passwort festlegen. */
export function ResetPasswordPage() {
  const { loading, user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const tokenHash = params.get("token_hash");
  const [verifying, setVerifying] = useState(Boolean(tokenHash));
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [errors, setErrors] = useState<{ password?: string | null; repeat?: string | null }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!tokenHash) return;
    let active = true;
    void supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" }).then(() => {
      if (active) setVerifying(false);
    });
    return () => {
      active = false;
    };
  }, [tokenHash]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next = {
      password: validate(password, required(), passwordRule),
      repeat: password === repeat ? null : t.validation.passwordMismatch,
    };
    setErrors(next);
    setFormError(null);
    if (next.password || next.repeat) return;
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setFormError(errorMessage(error));
    else navigate("/home", { replace: true });
  }

  if (loading || verifying) return <PageSpinner />;
  if (!user) {
    return (
      <AuthLayout title={t.auth.reset.title} intro={t.auth.reset.invalid}>
        <ButtonLink to="/forgot-password" size="lg" block>
          {t.auth.reset.requestNew}
        </ButtonLink>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title={t.auth.reset.title}>
      <form onSubmit={submit} noValidate className="space-y-5">
        <PasswordField label={t.auth.fields.newPassword} name="new_password" value={password} onChange={setPassword} error={errors.password} hint={t.auth.fields.passwordHint} autoComplete="new-password" />
        <PasswordField label={t.auth.fields.repeatPassword} name="repeat_password" value={repeat} onChange={setRepeat} error={errors.repeat} autoComplete="new-password" />
        {formError && <FormMessage>{formError}</FormMessage>}
        <Button type="submit" size="lg" block loading={busy}>
          {t.auth.reset.submit}
        </Button>
      </form>
    </AuthLayout>
  );
}
