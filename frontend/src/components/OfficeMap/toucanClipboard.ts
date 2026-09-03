// Copy-to-clipboard for the Toucan panel's Copy controls.
//
// Reports honestly: `false` means the text is NOT on the clipboard, so the
// button can say so rather than flashing "Copied!" over a no-op. The async
// Clipboard API is unavailable in insecure contexts and can be denied by
// permission, hence the execCommand fallback and hence the boolean.

export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Denied, or no secure context — fall through to the legacy path.
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  const area = document.createElement("textarea");
  area.value = text;
  // Off-screen but still focusable, which execCommand("copy") requires.
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "-1000px";
  area.style.opacity = "0";
  document.body.appendChild(area);
  try {
    area.select();
    return document.execCommand?.("copy") ?? false;
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
