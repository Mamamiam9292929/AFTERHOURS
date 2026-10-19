import { IconInfo } from "@/components/icons";
import { ButtonLink } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Feedback";
import { Logo } from "@/components/ui/Logo";
import { useAuth } from "@/features/auth/AuthProvider";
import { t } from "@/i18n";
import { useDocumentTitle } from "@/lib/hooks";

function Content() {
  return (
    <div className="max-w-2xl">
      <Notice tone="amber" icon={<IconInfo aria-hidden />} className="mb-8">
        {t.privacy.disclaimer}
      </Notice>
      <div className="space-y-8">
        {t.privacy.sections.map((section) => (
          <section key={section.title}>
            <h2 className="text-[19px] font-bold text-fg">{section.title}</h2>
            <ul className="mt-3 space-y-2.5">
              {section.items.map((item) => (
                <li key={item} className="flex gap-3 text-[15px] leading-snug text-fg">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-lime" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

/** Eigenständige Seite: ohne Anmeldung erreichbar (Link von der Registrierung) und aus dem Profil heraus. */
export function PrivacyPage() {
  useDocumentTitle(t.privacy.title);
  const { user } = useAuth();
  return (
    <div className="mx-auto w-full max-w-3xl px-5 pb-16 pt-safe sm:px-8">
      <div className="py-6">
        <Logo compact />
      </div>
      <h1 className="display chrome mb-6 text-[32px] sm:text-[37px]">{t.privacy.title}</h1>
      <Content />
      <ButtonLink to={user ? "/settings#account" : "/login"} variant="secondary" className="mt-8">
        {user ? t.privacy.toSettings : t.privacy.toLogin}
      </ButtonLink>
    </div>
  );
}
