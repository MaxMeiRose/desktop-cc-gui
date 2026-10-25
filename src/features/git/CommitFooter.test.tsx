import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommitFooter } from "./CommitFooter";
import { useGitStore } from "./store";
import { ipc } from "@/lib/ipc";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    gitGenerateCommitMessage: vi.fn(),
    gitCommitMessageChannel: vi.fn().mockResolvedValue({
      engine: "claude",
      baseUrl: "https://a.example/v1",
    }),
  },
}));
vi.mock("react-i18next", async (importOriginal) => ({
  ...await importOriginal<typeof import("react-i18next")>(),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "zh-CN" } }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const generate = vi.mocked(ipc.gitGenerateCommitMessage);

describe("CommitFooter AI draft", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onCommitMsgChange: ReturnType<typeof vi.fn>;
  let commit: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    onCommitMsgChange = vi.fn();
    commit = vi.fn().mockResolvedValue("sha");
    useGitStore.setState({ commit });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(
      <CommitFooter
        workspacePath="/ws/api"
        stagedCount={1}
        busy={false}
        commitMsg=""
        onCommitMsgChange={onCommitMsgChange}
        run={(_key, action) => void action()}
      />,
    ));
    // Flush the channel-tooltip probe so its state update lands inside act.
    await act(async () => {});
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  /** Buttons in order: the AI draft button, then commit. */
  const buttons = () => container.querySelectorAll("button");

  it("fills the box with the generated message for that repository, without committing", async () => {
    generate.mockResolvedValue({
      message: "  feat: add widget  ",
      engine: "claude",
      baseUrl: "https://a.example/v1",
    });
    await act(async () => { buttons()[0].click(); });
    // The current chat engine is explicit, and without a selection prop no
    // file filter is sent.
    expect(generate).toHaveBeenCalledWith("/ws/api", "claude", "zh-CN", null);
    // Surrounding whitespace is trimmed: the box is the message, not the
    // model's formatting.
    expect(onCommitMsgChange).toHaveBeenCalledWith("feat: add widget");
    expect(commit).not.toHaveBeenCalled();
  });

  it("sends the checked paths so the draft describes the actual commit", async () => {
    generate.mockResolvedValue({
      message: "feat: add widget",
      engine: "claude",
      baseUrl: "https://a.example/v1",
    });
    act(() => root.render(
      <CommitFooter
        workspacePath="/ws/api"
        stagedCount={2}
        busy={false}
        commitMsg=""
        onCommitMsgChange={onCommitMsgChange}
        run={(_key, action) => void action()}
        selectedCount={1}
        selectedFiles={new Set(["a.ts"])}
      />,
    ));
    await act(async () => { buttons()[0].click(); });
    expect(generate).toHaveBeenCalledWith("/ws/api", "claude", "zh-CN", ["a.ts"]);
    // Generation follows the selection, so nothing selected means no draft.
    act(() => root.render(
      <CommitFooter
        workspacePath="/ws/api"
        stagedCount={2}
        busy={false}
        commitMsg=""
        onCommitMsgChange={onCommitMsgChange}
        run={(_key, action) => void action()}
        selectedCount={0}
        selectedFiles={new Set()}
      />,
    ));
    expect(buttons()[0].disabled).toBe(true);
  });

  it("names the channel in the generate button tooltip", async () => {
    await act(async () => {});
    expect(buttons()[0].title).toBe("git.generateCommitMessageHint");
  });

  it("keeps the user's draft and reports the failure when generation fails", async () => {
    generate.mockRejectedValue("未找到可用渠道");
    await act(async () => { buttons()[0].click(); });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("未找到可用渠道");
    expect(onCommitMsgChange).not.toHaveBeenCalled();
  });

  it("leaves the box alone when the model returns nothing but blanks", async () => {
    generate.mockResolvedValue({ message: "   ", engine: "claude", baseUrl: "https://a.example/v1" });
    await act(async () => { buttons()[0].click(); });
    expect(onCommitMsgChange).not.toHaveBeenCalled();
  });

  it("disables generation when the repository has nothing staged", () => {
    useGitStore.setState({ commit });
    act(() => root.render(
      <CommitFooter
        workspacePath="/ws/api"
        stagedCount={0}
        busy={false}
        commitMsg=""
        onCommitMsgChange={onCommitMsgChange}
        run={(_key, action) => void action()}
      />,
    ));
    expect(buttons()[0].disabled).toBe(true);
  });
});
