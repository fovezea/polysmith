import { useState } from "react";
import type { AiConfig } from "@/config";
import {
  buildAiCadSystemPrompt,
  buildAiCadUserPrompt,
  buildAiWorkingReferences,
  commandPreviewLabel,
  type AiExecutableCommand,
  makeGetSessionStateCommand,
  makeGetViewportStateCommand,
  parseAiCommandEnvelope,
  prepareAiCommandBatchForState,
  requestOllamaChat,
  sendCoreCommand,
} from "@/lib";
import { useCadCoreStore } from "@/state";
import type { CoreCommand, CoreMessage, DocumentState, ViewportState } from "@/types";

interface AiAssistantPanelProps {
  config: AiConfig;
  status: string;
  document: DocumentState | null;
  viewport: ViewportState | null;
  onClose: () => void;
  onStartCore: () => Promise<void>;
}

interface ChatEntry {
  role: "user" | "assistant" | "system";
  text: string;
}

interface PendingBatch {
  message: string;
  commands: AiExecutableCommand[];
  continue: boolean;
  step: number;
}

function waitForCoreResponse(commandId: string, timeoutMs = 6000) {
  return new Promise<CoreMessage>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for core response to ${commandId}`));
    }, timeoutMs);

    const unsubscribe = useCadCoreStore.subscribe((state) => {
      const event = state.lastEvent;
      if (!event || event.id !== commandId) {
        return;
      }
      window.clearTimeout(timer);
      unsubscribe();
      if (event.type === "error") {
        reject(new Error(event.payload.message));
        return;
      }
      resolve(event);
    });
  });
}

async function sendAndWait(command: CoreCommand & { id: string }) {
  const response = waitForCoreResponse(command.id);
  await sendCoreCommand(command);
  await response;
}

async function refreshCoreSnapshot() {
  await sendAndWait(makeGetSessionStateCommand() as CoreCommand & { id: string });
  await sendAndWait(makeGetViewportStateCommand() as CoreCommand & { id: string });
}

export function AiAssistantPanel({
  config,
  status,
  document,
  viewport,
  onClose,
  onStartCore,
}: AiAssistantPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [activePrompt, setActivePrompt] = useState("");
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [pendingBatch, setPendingBatch] = useState<PendingBatch | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canAsk =
    !isThinking &&
    !isExecuting &&
    !pendingBatch &&
    config.model.trim().length > 0 &&
    config.baseUrl.trim().length > 0;
  const workingReferences = buildAiWorkingReferences(document, viewport);

  async function requestNextBatch(userPrompt: string, step: number) {
    setIsThinking(true);
    setError(null);
    try {
      const snapshot = useCadCoreStore.getState();
      const response = await requestOllamaChat(config, [
        { role: "system", content: buildAiCadSystemPrompt() },
        {
          role: "user",
          content: buildAiCadUserPrompt(
            userPrompt,
            snapshot.document ?? document,
            snapshot.viewport ?? viewport,
          ),
        },
      ]);
      const envelope = parseAiCommandEnvelope(response);
      const preparedBatch = prepareAiCommandBatchForState(
        envelope.commands,
        envelope.continue,
        snapshot.document,
        snapshot.viewport,
      );
      setEntries((current) => [
        ...current,
        { role: "assistant", text: envelope.message },
        ...preparedBatch.notices.map((notice) => ({
          role: "system" as const,
          text: notice,
        })),
      ]);
      setPendingBatch({
        message: envelope.message,
        commands: preparedBatch.commands,
        continue: preparedBatch.continue,
        step,
      });
    } catch (caught) {
      setError(String(caught));
    } finally {
      setIsThinking(false);
    }
  }

  async function submitPrompt() {
    const nextPrompt = prompt.trim();
    if (!nextPrompt || !canAsk) {
      return;
    }
    setActivePrompt(nextPrompt);
    setPrompt("");
    setEntries((current) => [...current, { role: "user", text: nextPrompt }]);
    await requestNextBatch(nextPrompt, 1);
  }

  async function runPendingBatch() {
    if (!pendingBatch) {
      return;
    }
    setIsExecuting(true);
    setError(null);
    try {
      for (const command of pendingBatch.commands) {
        await sendAndWait(command);
      }
      await refreshCoreSnapshot();
      setEntries((current) => [
        ...current,
        {
          role: "system",
          text: `Executed ${pendingBatch.commands.length} command${
            pendingBatch.commands.length === 1 ? "" : "s"
          }.`,
        },
      ]);
      const shouldContinue =
        pendingBatch.continue && pendingBatch.step < config.maxAgentSteps;
      const nextStep = pendingBatch.step + 1;
      setPendingBatch(null);
      if (shouldContinue) {
        await requestNextBatch(activePrompt, nextStep);
      }
    } catch (caught) {
      setError(String(caught));
    } finally {
      setIsExecuting(false);
    }
  }

  function handlePromptKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    void submitPrompt();
  }

  return (
    <aside className="cad-panel-soft flex w-[min(420px,42vw)] min-w-[360px] flex-col !rounded-none border-l border-white/10">
      <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <p className="cad-kicker">AI Assistant</p>
          <p className="mt-1 text-xs text-on-surface-muted">
            Ollama · {config.model.trim() || "No model"}
          </p>
        </div>
        <button
          type="button"
          className="cad-ribbon-action"
          onClick={onClose}
        >
          Close
        </button>
      </header>

      <div className="cad-scrollbar min-h-0 flex-1 space-y-3 overflow-auto px-4 py-4">
        {status !== "connected" ? (
          <div className="rounded-md border border-white/10 bg-white/[0.025] px-3 py-3">
            <p className="text-sm text-on-surface">
              The CAD core is not running.
            </p>
            <button
              type="button"
              className="cad-ribbon-action mt-3"
              onClick={() => void onStartCore()}
            >
              Start Core
            </button>
          </div>
        ) : null}

        {entries.length === 0 ? (
          <p className="text-sm leading-5 text-on-surface-muted">
            Ask for simple CAD actions. The assistant will return JSON command
            batches for review before anything is sent to the core.
          </p>
        ) : null}

        <section className="rounded-md border border-white/10 bg-black/15 px-3 py-3">
          <p className="cad-kicker">Working References</p>
          <div className="mt-2 space-y-1 font-mono text-[0.7rem] leading-4 text-on-surface-muted">
            {workingReferences.map((reference) => (
              <p key={reference} className="break-words">
                {reference}
              </p>
            ))}
          </div>
        </section>

        {entries.map((entry, index) => (
          <div
            key={`${entry.role}-${index}`}
            className={
              entry.role === "user"
                ? "rounded-md bg-primary/15 px-3 py-2 text-sm text-on-surface"
                : entry.role === "assistant"
                  ? "rounded-md bg-white/[0.04] px-3 py-2 text-sm text-on-surface"
                  : "rounded-md border border-white/10 px-3 py-2 text-xs text-on-surface-muted"
            }
          >
            {entry.text}
          </div>
        ))}

        {pendingBatch ? (
          <section className="rounded-md border border-primary-edge/40 bg-white/[0.025] px-3 py-3">
            <p className="cad-kicker">Command Preview</p>
            <div className="mt-3 max-h-60 space-y-2 overflow-auto">
              {pendingBatch.commands.map((command) => (
                <pre
                  key={command.id}
                  className="overflow-auto rounded-md bg-black/25 px-3 py-2 text-xs text-on-surface-muted"
                >
                  {commandPreviewLabel(command)}
                </pre>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                className="cad-ribbon-action cad-ribbon-action-primary"
                disabled={isExecuting || status !== "connected"}
                onClick={() => void runPendingBatch()}
              >
                {isExecuting ? "Running..." : "Run Commands"}
              </button>
              <button
                type="button"
                className="cad-ribbon-action"
                disabled={isExecuting}
                onClick={() => setPendingBatch(null)}
              >
                Cancel
              </button>
            </div>
          </section>
        ) : null}

        {isThinking ? (
          <p className="text-sm text-on-surface-muted">Waiting for Ollama...</p>
        ) : null}
        {error ? (
          <p className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        ) : null}
      </div>

      <footer className="border-t border-white/10 px-4 py-3">
        <textarea
          className="min-h-24 w-full resize-none rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-on-surface outline-none transition-colors focus:border-primary-edge"
          value={prompt}
          placeholder="Create a 60 by 40 mm rectangle on XY and extrude it 20 mm"
          disabled={Boolean(pendingBatch) || isThinking || isExecuting}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={handlePromptKeyDown}
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-xs text-on-surface-muted">
            {config.enabled ? "Preview before run" : "AI disabled"}
          </span>
          <button
            type="button"
            className="cad-ribbon-action cad-ribbon-action-primary"
            disabled={!canAsk || status !== "connected"}
            onClick={() => void submitPrompt()}
          >
            Send
          </button>
        </div>
      </footer>
    </aside>
  );
}
