import type { SessionState } from "@/types";
import { useTranslation } from "react-i18next";

interface SessionPanelProps {
  session: SessionState | null;
}

export function SessionPanel({ session }: SessionPanelProps) {
  const { t } = useTranslation();
  if (!session) {
    return (
      <section className="pointer-events-auto cad-floating-panel px-4 py-4">
        <p className="cad-kicker">{t("session.title")}</p>
        <p className="mt-3 text-sm text-on-surface-muted">
          {t("session.noSnapshot")}
        </p>
      </section>
    );
  }

  return (
    <section className="pointer-events-auto cad-floating-panel px-4 py-4">
      <p className="cad-kicker">{t("session.title")}</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-on-surface-dim">
            {t("session.documents")}
          </p>
          <p className="cad-metric mt-2">{session.document_count}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-on-surface-dim">
            {t("common.active")}
          </p>
          <p className="cad-metric mt-2">
            {session.active_document_id ?? t("common.none")}
          </p>
        </div>
      </div>
      <div className="mt-4 flex gap-2 text-xs uppercase tracking-[0.14em]">
        <span
          className={`rounded-full px-2 py-1 ${
            session.can_undo
              ? "cad-session-chip-active text-primary-soft"
              : "cad-session-chip-idle text-on-surface-dim"
          }`}
        >
          {t("session.undoState", {
            state: session.can_undo ? t("common.ready") : t("common.empty"),
          })}
        </span>
        <span
          className={`rounded-full px-2 py-1 ${
            session.can_redo
              ? "cad-session-chip-active text-primary-soft"
              : "cad-session-chip-idle text-on-surface-dim"
          }`}
        >
          {t("session.redoState", {
            state: session.can_redo ? t("common.ready") : t("common.empty"),
          })}
        </span>
      </div>
    </section>
  );
}
