import { useNavigate, useParams } from "react-router-dom";
import { IconShield } from "@/components/icons";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState, ErrorState, Notice, PageSpinner } from "@/components/ui/Feedback";
import { useToast } from "@/components/ui/Toast";
import { t } from "@/i18n";
import { errorMessage } from "@/lib/errors";
import { useDocumentTitle } from "@/lib/hooks";
import { useAcceptInvitation, useInvitationPreview } from "./api";

type FailureStatus = keyof typeof t.crews.join.status;

function Failure({ status }: { status: FailureStatus }) {
  const copy = t.crews.join.status[status];
  return (
    <EmptyState
      title={copy.title}
      body={copy.body}
      action={
        <ButtonLink to="/crews" variant="secondary" size="sm">
          {t.crews.join.toCrews}
        </ButtonLink>
      }
    />
  );
}

/** Ziel eines Einladungslinks: zeigt, wohin die Einladung führt, und fragt ausdrücklich nach. */
export function JoinPage() {
  useDocumentTitle(t.crews.join.title);
  const { token } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const preview = useInvitationPreview(token);
  const accept = useAcceptInvitation();

  if (preview.isPending) return <PageSpinner />;
  if (preview.isError) return <ErrorState error={preview.error} onRetry={() => void preview.refetch()} />;
  const data = preview.data;

  if (accept.data && accept.data.status !== "joined" && accept.data.status !== "already_member") return <Failure status={accept.data.status} />;
  if (data.status === "already_member") {
    return <EmptyState title={t.crews.join.alreadyTitle} body={t.crews.join.alreadyBody} action={<ButtonLink to={`/crews/${data.crew_id}`}>{t.crews.join.toCrew}</ButtonLink>} />;
  }
  if (data.status !== "valid") return <Failure status={data.status} />;

  function join() {
    if (!token || data.status !== "valid") return;
    const crewName = data.crew.name;
    accept.mutate(token, {
      onSuccess: (result) => {
        if (result.status === "joined" || result.status === "already_member") {
          toast.success(t.crews.join.joined(crewName));
          navigate(`/crews/${result.crew_id}`, { replace: true });
        }
      },
    });
  }

  return (
    <div className="mx-auto max-w-md pt-4 sm:pt-10">
      <p className="text-[15px] text-muted">{data.invited_by ? t.crews.join.invitedBy(data.invited_by) : t.crews.join.invitedAnonymous}</p>
      <div className="mt-4 flex items-center gap-4">
        <span className="flex size-20 shrink-0 items-center justify-center rounded-3xl bg-surface text-[44px]" aria-hidden>
          {data.crew.emoji}
        </span>
        <div className="min-w-0">
          <h1 className="display break-words text-[44px] text-fg">{data.crew.name}</h1>
          <p className="mt-1 text-[15px] text-muted">{t.crews.join.crewLine(t.members(data.crew.member_count))}</p>
        </div>
      </div>
      <Notice icon={<IconShield aria-hidden />} className="mt-7">
        {t.crews.join.whatHappens}
      </Notice>
      {accept.isError && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {errorMessage(accept.error)}
        </p>
      )}
      <div className="mt-6 flex flex-col gap-2.5">
        <Button size="lg" block loading={accept.isPending} onClick={join}>
          {t.crews.join.accept}
        </Button>
        <Button
          variant="ghost"
          block
          disabled={accept.isPending}
          onClick={() => {
            toast.success(t.crews.join.declined);
            navigate("/home", { replace: true });
          }}
        >
          {t.crews.join.decline}
        </Button>
      </div>
    </div>
  );
}
