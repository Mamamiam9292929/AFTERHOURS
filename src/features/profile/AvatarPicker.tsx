import { useRef, useState } from "react";
import { IconCamera } from "@/components/icons";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { t } from "@/i18n";
import { fileToAvatarDataUrl } from "@/lib/image";

interface AvatarPickerProps {
  userId: string;
  name: string;
  value: string | null;
  onChange: (dataUrl: string | null) => void;
}

/** Profilbild wählen: wird im Browser verkleinert, bevor es gespeichert wird. */
export function AvatarPicker({ userId, name, value, onChange }: AvatarPickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    const result = await fileToAvatarDataUrl(file);
    if (result.ok) {
      setError(null);
      onChange(result.dataUrl);
    } else {
      setError(t.onboarding.profile.photoErrors[result.error]);
    }
    if (input.current) input.current.value = "";
  }

  return (
    <div>
      <p className="mb-2 text-sm font-medium text-fg">{t.onboarding.profile.photo}</p>
      <div className="flex items-center gap-4">
        <Avatar person={{ id: userId, display_name: name || "?", avatar_url: value }} size="xl" decorative />
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => input.current?.click()} icon={<IconCamera className="size-4" aria-hidden />}>
              {value ? t.onboarding.profile.photoChange : t.onboarding.profile.photoAdd}
            </Button>
            {value && (
              <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
                {t.onboarding.profile.photoRemove}
              </Button>
            )}
          </div>
          <p className="text-[13px] text-muted">{t.onboarding.profile.photoHint}</p>
        </div>
      </div>
      <input ref={input} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-label={t.onboarding.profile.photo} onChange={(e) => void pick(e.target.files?.[0])} />
      {error && (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
