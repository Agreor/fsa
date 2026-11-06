export function createPdfReader({ pdfjs, workerSrc }) {
  if (workerSrc && pdfjs.GlobalWorkerOptions) pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

  return {
    // Pages as pictures ({ width, height, data } RGBA) for text recognition. makeCanvas(w, h) -> a 2d canvas.
    async renderPages(bytes, { scale = 3, makeCanvas }) {
      const task = pdfjs.getDocument({ data: bytes.slice() });
      try {
        const document = await task.promise, pages = [];
        for (let number = 1; number <= document.numPages; number++) {
          const page = await document.getPage(number), viewport = page.getViewport({ scale });
          const canvas = makeCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height)), context = canvas.getContext("2d");
          await page.render({ canvasContext: context, viewport }).promise;
          const image = context.getImageData(0, 0, canvas.width, canvas.height);
          pages.push({ width: canvas.width, height: canvas.height, data: image.data });
        }
        return pages;
      } finally { await task.destroy(); }
    },
    async extractPdf(bytes, askPassword = async () => null) {
      if (!(bytes instanceof Uint8Array) || bytes.length === 0) return { error: "unreadable" };
      let password;
      let wrong = false;

      for (let attempt = 0; attempt < 3; attempt++) {
        let task;
        try {
          task = pdfjs.getDocument({ data: bytes.slice(), ...(password === undefined ? {} : { password }) });
          const document = await task.promise;
          const pages = [];
          let hasText = false;
          for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
            const page = await document.getPage(pageNumber);
            const content = await page.getTextContent();
            const items = content.items.filter((item) => typeof item.str === "string" && item.str.trim()).map((item) => ({
              x: Math.round(item.transform[4]), y: item.transform[5], text: item.str.trim().replace(/\s+/g, " "),
            }));
            items.sort((a, b) => b.y - a.y || a.x - b.x);
            const rows = [];
            for (const item of items) {
              let row = rows.find((candidate) => Math.abs(candidate.rawY - item.y) <= 2);
              if (!row) rows.push(row = { rawY: item.y, items: [] });
              row.items.push({ x: item.x, text: item.text });
            }
            const lines = rows.map((row) => {
              row.items.sort((a, b) => a.x - b.x);
              return { y: Math.round(row.rawY), items: row.items, text: row.items.map((item) => item.text).join(" ") };
            }).sort((a, b) => b.y - a.y);
            hasText ||= lines.length > 0;
            pages.push({ lines });
          }
          await task.destroy();
          return hasText ? { pages } : { error: "no_text" };
        } catch (error) {
          try { await task?.destroy(); } catch {}
          if (error?.name === "PasswordException") {
            const code = error.code === 2 ? "wrong_password" : "password_needed";
            const answer = await askPassword({ ...(wrong ? { wrong: true } : {}) });
            if (answer == null) return { error: code };
            password = answer;
            wrong = true;
            continue;
          }
          return { error: "unreadable" };
        }
      }
      return { error: "wrong_password" };
    },
  };
}
