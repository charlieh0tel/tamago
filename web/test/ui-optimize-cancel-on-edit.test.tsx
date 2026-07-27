// @vitest-environment jsdom
// Editing the design while Optimize is running cancels the run so its writeback
// cannot clobber the edit.
import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App";
import { CancelledError, type EngineService } from "../src/app/worker/client";
import { makeFakeEngine } from "./fakeEngine";

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "";
});

function clickText(container: HTMLElement, text: string): void {
  const el = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent === text,
  );
  if (el === undefined) {
    throw new Error(`button "${text}" missing`);
  }
  fireEvent.click(el);
}

describe("optimize cancel-on-edit", () => {
  it("cancels a running Optimize when the design is edited", async () => {
    // A never-resolving optimize whose cancel we can observe.
    const cancel = vi.fn();
    const pending = new Promise<never>(() => {});
    const engine: EngineService = {
      ...makeFakeEngine(),
      optimize: () => ({ promise: pending, cancel }),
    };

    const { container } = render(<App engine={engine} />);

    clickText(container, "Optimize");
    await waitFor(() => expect(container.textContent).toContain("optimizing"));

    // Edit during the run.
    const freq = container.querySelector<HTMLInputElement>("#freq");
    fireEvent.change(freq as HTMLInputElement, { target: { value: "146.2" } });

    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
  });

  it("reports the design-changed cancel reason", async () => {
    let reject: (e: unknown) => void = () => {};
    const engine: EngineService = {
      ...makeFakeEngine(),
      optimize: () => ({
        promise: new Promise<never>((_res, rej) => {
          reject = rej;
        }),
        cancel: () => reject(new CancelledError()),
      }),
    };

    const { container } = render(<App engine={engine} />);
    clickText(container, "Optimize");
    await waitFor(() => expect(container.textContent).toContain("optimizing"));

    const freq = container.querySelector<HTMLInputElement>("#freq");
    fireEvent.change(freq as HTMLInputElement, { target: { value: "146.2" } });

    await waitFor(() => expect(container.textContent).toContain("the design changed"));
  });
});
