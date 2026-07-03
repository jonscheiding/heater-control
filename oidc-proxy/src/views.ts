function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!,
  );
}

const PAGE = (title: string, body: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        font-family: system-ui, sans-serif; margin: 0; min-height: 100vh;
        display: grid; place-items: center; background: Canvas; color: CanvasText;
      }
      main { width: min(22rem, 90vw); }
      h1 { font-size: 1.25rem; margin: 0 0 1rem; }
      label { display: block; font-size: 0.85rem; margin: 0.75rem 0 0.25rem; }
      input {
        width: 100%; box-sizing: border-box; padding: 0.6rem; font-size: 1rem;
        border: 1px solid GrayText; border-radius: 0.4rem; background: Field; color: FieldText;
      }
      button {
        width: 100%; margin-top: 1.25rem; padding: 0.7rem; font-size: 1rem;
        border: 0; border-radius: 0.4rem; background: AccentColor; color: AccentColorText; cursor: pointer;
      }
      .error { color: #b00020; font-size: 0.9rem; margin: 0.5rem 0 0; }
    </style>
  </head>
  <body><main>${body}</main></body>
</html>`;

/** Render the ScheduleMaster login form for an interaction. */
export function loginPage(uid: string, error?: string): string {
  return PAGE(
    "Sign in with ScheduleMaster",
    `<h1>Sign in with ScheduleMaster</h1>
     <form method="post" action="/interaction/${escapeHtml(uid)}/login" autocomplete="on">
       ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
       <label for="username">ScheduleMaster username</label>
       <input id="username" name="username" autocomplete="username" autofocus required />
       <label for="password">Password</label>
       <input id="password" name="password" type="password" autocomplete="current-password" required />
       <button type="submit">Sign in</button>
     </form>`,
  );
}

/** Render a terminal error page (e.g. the scrape flow broke). */
export function errorPage(message: string): string {
  return PAGE(
    "Sign-in error",
    `<h1>Sign-in error</h1><p class="error">${escapeHtml(message)}</p>`,
  );
}
