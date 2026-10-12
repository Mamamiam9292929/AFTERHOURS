import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { IconBot, IconInfo, IconSparkles, IconVote } from "@/components/icons";
import { PageHeader, Section } from "@/components/layout/Page";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState, Notice } from "@/components/ui/Feedback";
import { FormMessage, TextAreaField } from "@/components/ui/Field";
import { ActivityCard } from "@/features/discover/ActivityCard";
import { typicalPriceCents } from "@/features/discover/api";
import { MAX_POLL_OPTIONS, usePollDraft } from "@/features/polls/draft";
import { useProfile } from "@/features/profile/api";
import { t } from "@/i18n";
import { useDocumentTitle } from "@/lib/hooks";
import { assistantProvider, isAssistantEnabled, type AssistantReply } from "./provider";

export function AssistantPage() {
  useDocumentTitle(t.assistant.title);
  const navigate = useNavigate();
  const profile = useProfile();
  const draft = usePollDraft();
  const [message, setMessage] = useState("");
  const ask = useMutation({ mutationFn: (text: string): Promise<AssistantReply> => assistantProvider.plan({ message: text, city: profile.data?.city ?? null }) });

  if (!isAssistantEnabled) {
    return (
      <>
        <PageHeader title={t.assistant.title} back={{ to: "/profile", label: t.profile.title }} />
        <EmptyState
          className="max-w-2xl"
          icon={<IconBot aria-hidden />}
          title={t.assistant.disabled.title}
          body={
            <>
              {t.assistant.disabled.body}
              <span className="mt-2 block">{t.assistant.disabled.how}</span>
              <span className="mt-2 block">{t.assistant.disabled.alternative}</span>
            </>
          }
          action={<ButtonLink to="/discover">{t.assistant.disabled.toDiscover}</ButtonLink>}
        />
      </>
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (message.trim().length >= 5) ask.mutate(message.trim());
  }

  function preparePoll() {
    for (const { activity } of (ask.data?.suggestions ?? []).slice(0, MAX_POLL_OPTIONS)) {
      draft.add({ activityId: activity.id, title: activity.name, priceCents: typicalPriceCents(activity) });
    }
    navigate("/polls/new");
  }

  return (
    <>
      <PageHeader title={t.assistant.title} lead={t.assistant.lead} back={{ to: "/profile", label: t.profile.title }} />
      <div className="max-w-3xl">
        <form onSubmit={submit} className="space-y-3">
          <TextAreaField label={t.assistant.inputLabel} name="assistant_message" value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t.assistant.placeholder} maxLength={500} rows={3} />
          <div className="flex flex-wrap gap-2">
            {t.assistant.examples.map((example) => (
              <button key={example} type="button" onClick={() => setMessage(example)} className="rounded-full border border-line-strong px-3.5 py-2 text-left text-[13px] text-muted hover:border-faint hover:text-fg">
                {example}
              </button>
            ))}
          </div>
          <Button type="submit" size="lg" loading={ask.isPending} disabled={message.trim().length < 5} icon={<IconSparkles className="size-5" aria-hidden />}>
            {ask.isPending ? t.assistant.thinking : t.assistant.submit}
          </Button>
        </form>

        {ask.isError && (
          <div className="mt-6">
            <FormMessage>{t.assistant.unavailable}</FormMessage>
          </div>
        )}

        {ask.data && (
          <div aria-live="polite" className="mt-9">
            <Section title={t.assistant.understood}>
              <p className="text-[15px] leading-snug text-fg">{ask.data.understood}</p>
              {ask.data.missing && (
                <Notice tone="amber" icon={<IconInfo aria-hidden />} title={t.assistant.missing} className="mt-3">
                  {ask.data.missing}
                </Notice>
              )}
            </Section>
            <Section
              title={t.assistant.suggestions}
              action={
                ask.data.suggestions.length > 0 ? (
                  <Button size="sm" onClick={preparePoll} icon={<IconVote className="size-4" aria-hidden />}>
                    {t.assistant.addToPoll}
                  </Button>
                ) : undefined
              }
            >
              {ask.data.suggestions.length === 0 ? (
                <p className="text-[15px] text-muted">{t.assistant.noSuggestions}</p>
              ) : (
                <ul className="grid gap-5 sm:grid-cols-2">
                  {ask.data.suggestions.map((suggestion) => (
                    <li key={suggestion.activity.id} className="space-y-2.5">
                      <ActivityCard activity={suggestion.activity} compact />
                      <p className="text-sm leading-snug text-fg">
                        <span className="font-semibold">{t.assistant.why}: </span>
                        {suggestion.reason}
                      </p>
                      {suggestion.caveats.length > 0 && <p className="text-[13px] leading-snug text-amber">{suggestion.caveats.join(" ")}</p>}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-5 text-[13px] leading-snug text-faint">{t.assistant.caveat}</p>
            </Section>
          </div>
        )}
      </div>
    </>
  );
}
