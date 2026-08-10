import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalAgentComposer } from "./LocalAgentComposer";
import type { LocalAgentTargetSnapshot } from "./targets";
import type {
  LocalAgentRunRequest,
  LocalAgentRunResult,
  LocalAgentStatus,
  LocalAgentStreamEvent,
} from "./types";

afterEach(cleanup);

const statuses: LocalAgentStatus[] = [
  {
    kind: "claude",
    mention: "@claude",
    label: "Claude Code",
    installed: true,
    compatible: true,
    pathLabel: "claude (PATH)",
    version: "2.0.0",
    reason: null,
  },
  {
    kind: "codex",
    mention: "@codex",
    label: "Codex",
    installed: true,
    compatible: true,
    pathLabel: "codex (PATH)",
    version: "1.0.0",
    reason: null,
  },
  {
    kind: "opencode",
    mention: "@opencode",
    label: "OpenCode",
    installed: true,
    compatible: false,
    pathLabel: "opencode (PATH)",
    version: "0.1.0",
    reason: "This version is not supported.",
  },
];

const selectionSnapshot: LocalAgentTargetSnapshot = {
  documentId: "doc-1",
  source: "안녕 world",
  surface: "source",
  kind: "selection",
  characterRange: { start: 3, end: 8 },
  byteRange: { start: 7, end: 12 },
  selectedText: "world",
  proseMirrorRange: null,
};

const insertSnapshot: LocalAgentTargetSnapshot = {
  ...selectionSnapshot,
  kind: "insert",
  characterRange: { start: 3, end: 3 },
  byteRange: { start: 7, end: 7 },
  selectedText: "",
};

function resultFor(request: LocalAgentRunRequest): LocalAgentRunResult {
  return {
    schemaVersion: 1,
    requestId: request.requestId,
    documentId: request.documentId,
    agent: request.agent,
    target: request.target,
    markdown: "- done",
    summary: "Done",
    warnings: [],
  };
}

function renderComposer(
  options: Partial<React.ComponentProps<typeof LocalAgentComposer>> = {},
) {
  const services = options.services ?? {
    listStatuses: vi.fn().mockResolvedValue(statuses),
    run: vi.fn(),
    cancel: vi.fn(),
  };
  const props = {
    snapshot: selectionSnapshot,
    disclosureAccepted: true,
    preferredAgent: "codex" as const,
    onDisclosureAcceptedChange: vi.fn(),
    onClose: vi.fn(),
    onResult: vi.fn(),
    services,
    ...options,
  };
  return { ...render(<LocalAgentComposer {...props} />), props, services };
}

async function chooseAgent(mention: string) {
  const change = screen.queryByRole("button", { name: "Change local agent" });
  if (change) fireEvent.click(change);
  fireEvent.change(screen.getByLabelText("Local agent"), {
    target: { value: mention },
  });
  await waitFor(() =>
    expect(
      screen.getByRole("option", { name: new RegExp(mention, "i") }),
    ).toBeInTheDocument(),
  );
  fireEvent.click(
    screen.getByRole("option", { name: new RegExp(mention, "i") }),
  );
}

async function waitForStatuses() {
  fireEvent.click(screen.getByRole("button", { name: "Change local agent" }));
  await waitFor(() =>
    expect(screen.getByRole("option", { name: /@codex/i })).toBeEnabled(),
  );
  fireEvent.keyDown(screen.getByLabelText("Local agent"), { key: "Escape" });
}

describe("LocalAgentComposer", () => {
  it("shows the fixed mention completion, keyboard selection, and incompatible status reason", async () => {
    renderComposer({ preferredAgent: null });
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /@claude/i })).toBeEnabled(),
    );
    expect(
      within(screen.getByRole("listbox")).getAllByRole("option"),
    ).toHaveLength(3);
    expect(screen.getByRole("option", { name: /@opencode/i })).toBeDisabled();
    expect(
      screen.getByRole("option", { name: /@opencode/i }),
    ).toHaveTextContent("This version is not supported.");

    const input = screen.getByLabelText("Local agent");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Tab" });
    expect(screen.getByText("@claude")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove @claude" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await chooseAgent("@codex");
    fireEvent.click(screen.getByRole("button", { name: "Change local agent" }));
    fireEvent.keyDown(screen.getByLabelText("Local agent"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("preserves the instruction and target while replacing a selected agent", async () => {
    renderComposer();
    await waitForStatuses();
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "Turn this into a checklist" },
    });
    fireEvent.change(screen.getByLabelText("Apply result to"), {
      target: { value: "document" },
    });
    await chooseAgent("@claude");
    expect(screen.getByLabelText("Instruction")).toHaveValue(
      "Turn this into a checklist",
    );
    expect(screen.getByLabelText("Apply result to")).toHaveValue("document");
  });

  it("uses selection and insert defaults, and builds an exact immutable run request only on Run", async () => {
    const run = vi
      .fn()
      .mockImplementation(async (request: LocalAgentRunRequest) =>
        resultFor(request),
      );
    const { props } = renderComposer({
      services: {
        listStatuses: vi.fn().mockResolvedValue(statuses),
        run,
        cancel: vi.fn(),
      },
    });
    await waitForStatuses();
    const original = selectionSnapshot.source;
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "  Turn this into a checklist  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run @codex" }));
    await waitFor(() => expect(props.onResult).toHaveBeenCalledTimes(1));
    const request = run.mock.calls[0][0] as LocalAgentRunRequest;
    expect(request).toMatchObject({
      documentId: "doc-1",
      agent: "codex",
      target: "selection",
      source: "안녕 world",
      selection: { start: 7, end: 12 },
      cursor: null,
      instruction: "Turn this into a checklist",
    });
    expect(request.requestId).toEqual(expect.any(String));
    expect(selectionSnapshot.source).toBe(original);
    expect(props.onResult).toHaveBeenCalledWith(
      resultFor(request),
      selectionSnapshot,
      request,
    );

    cleanup();
    const documentRun = vi
      .fn()
      .mockImplementation(async (next: LocalAgentRunRequest) =>
        resultFor(next),
      );
    renderComposer({
      services: {
        listStatuses: vi.fn().mockResolvedValue(statuses),
        run: documentRun,
        cancel: vi.fn(),
      },
    });
    await waitForStatuses();
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "Summarize it" },
    });
    fireEvent.change(screen.getByLabelText("Apply result to"), {
      target: { value: "document" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run @codex" }));
    await waitFor(() => expect(documentRun).toHaveBeenCalledTimes(1));
    expect(documentRun.mock.calls[0][0]).toMatchObject({
      documentId: "doc-1",
      target: "document",
      source: "안녕 world",
      selection: null,
      cursor: null,
      instruction: "Summarize it",
    });

    cleanup();
    const insertRun = vi
      .fn()
      .mockImplementation(async (next: LocalAgentRunRequest) =>
        resultFor(next),
      );
    renderComposer({
      snapshot: insertSnapshot,
      services: {
        listStatuses: vi.fn().mockResolvedValue(statuses),
        run: insertRun,
        cancel: vi.fn(),
      },
    });
    await waitForStatuses();
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "Insert a heading" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run @codex" }));
    await waitFor(() => expect(insertRun).toHaveBeenCalledTimes(1));
    expect(insertRun.mock.calls[0][0]).toMatchObject({
      target: "insert",
      selection: null,
      cursor: 7,
    });
  });

  it("requires disclosure, compatibility, prompt, and an idle request before it can run", async () => {
    const { rerender, props } = renderComposer({ disclosureAccepted: false });
    await waitForStatuses();
    expect(screen.getByRole("button", { name: "Run @codex" })).toBeDisabled();
    fireEvent.click(
      screen.getByRole("switch", { name: "Allow local agent processing" }),
    );
    expect(props.onDisclosureAcceptedChange).toHaveBeenCalledWith(true);
    rerender(<LocalAgentComposer {...props} disclosureAccepted />);
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "Use it" },
    });
    cleanup();
    renderComposer({ preferredAgent: "opencode" });
    await waitForStatuses();
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "Use it" },
    });
    expect(
      screen.getByRole("button", { name: "Run @opencode" }),
    ).toBeDisabled();
  });

  it("keeps Close disabled during a run, cancels its exact request, and sanitizes service failures", async () => {
    const pending = deferred<LocalAgentRunResult>();
    const cancel = vi.fn().mockResolvedValue(true);
    const run = vi
      .fn()
      .mockImplementation(
        (
          request: LocalAgentRunRequest,
          onEvent: (event: LocalAgentStreamEvent) => void,
        ) => {
          onEvent({ type: "running", requestId: request.requestId });
          return pending.promise;
        },
      );
    const { props } = renderComposer({
      services: {
        listStatuses: vi.fn().mockResolvedValue(statuses),
        run,
        cancel,
      },
    });
    await waitForStatuses();
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "Use it" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run @codex" }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Local agent is running…")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Close local agent" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel local agent" }));
    expect(cancel).toHaveBeenCalledWith(run.mock.calls[0][0].requestId);
    await act(async () =>
      pending.reject(new Error("token sk-secret at /private/tmp/request")),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not run local agent.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      /sk-secret|private\/tmp/i,
    );
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("ignores stale status responses after unmount and forwards only content-free lifecycle status", async () => {
    const pendingStatuses = deferred<LocalAgentStatus[]>();
    const { unmount } = renderComposer({
      services: {
        listStatuses: vi.fn().mockReturnValue(pendingStatuses.promise),
        run: vi.fn(),
        cancel: vi.fn(),
      },
    });
    unmount();
    await act(async () => pendingStatuses.resolve(statuses));

    const run = vi.fn().mockImplementation(async (request, onEvent) => {
      onEvent({ type: "running", requestId: request.requestId });
      onEvent({
        type: "failed",
        requestId: request.requestId,
        code: "private-code",
        message: "secret body /tmp/x",
      });
      throw new Error("secret body /tmp/x");
    });
    renderComposer({
      services: {
        listStatuses: vi.fn().mockResolvedValue(statuses),
        run,
        cancel: vi.fn(),
      },
    });
    await waitForStatuses();
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "Use it" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run @codex" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not run local agent.",
    );
    expect(
      screen.queryByText(/secret body|private-code/i),
    ).not.toBeInTheDocument();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}
