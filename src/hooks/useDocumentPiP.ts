import { useCallback, useEffect, useState } from 'react';

interface DocumentPictureInPictureAPI {
  requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>;
  window?: Window | null;
}

export function useDocumentPiP() {
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [pipContainer, setPipContainer] = useState<HTMLElement | null>(null);

  const isSupported =
    typeof window !== 'undefined' &&
    'documentPictureInPicture' in window &&
    typeof (window as unknown as { documentPictureInPicture?: DocumentPictureInPictureAPI })
      .documentPictureInPicture?.requestWindow === 'function';

  const closePiP = useCallback(() => {
    if (pipWindow && !pipWindow.closed) {
      pipWindow.close();
    }
    setPipWindow(null);
    setPipContainer(null);
  }, [pipWindow]);

  const openPiP = useCallback(async () => {
    if (!isSupported) return false;

    if (pipWindow && !pipWindow.closed) {
      pipWindow.focus();
      return true;
    }

    const api = (window as unknown as { documentPictureInPicture: DocumentPictureInPictureAPI })
      .documentPictureInPicture;

    const win = await api.requestWindow({
      width: 370,
      height: 520,
    });

    // Copy stylesheets so Tailwind styles and fonts render identically inside the OS PiP window
    Array.from(document.styleSheets).forEach((sheet) => {
      try {
        if (sheet.href) {
          const link = win.document.createElement('link');
          link.rel = 'stylesheet';
          link.href = sheet.href;
          win.document.head.appendChild(link);
        } else {
          const cssRules = Array.from(sheet.cssRules)
            .map((rule) => rule.cssText)
            .join('\n');
          const style = win.document.createElement('style');
          style.textContent = cssRules;
          win.document.head.appendChild(style);
        }
      } catch {
        if (sheet.href) {
          const link = win.document.createElement('link');
          link.rel = 'stylesheet';
          link.href = sheet.href;
          win.document.head.appendChild(link);
        }
      }
    });

    win.document.title = 'Zia AI — Janela Flutuante';
    win.document.documentElement.className = 'dark';
    win.document.body.style.margin = '0';
    win.document.body.style.backgroundColor = '#090d16';
    win.document.body.style.color = '#f1f5f9';
    win.document.body.style.height = '100vh';
    win.document.body.style.overflow = 'hidden';

    const mountNode = win.document.createElement('div');
    mountNode.style.height = '100%';
    mountNode.style.width = '100%';
    win.document.body.appendChild(mountNode);

    win.addEventListener('pagehide', () => {
      setPipWindow(null);
      setPipContainer(null);
    });

    setPipWindow(win);
    setPipContainer(mountNode);
    return true;
  }, [isSupported, pipWindow]);

  const resizePiP = useCallback(
    (width: number, height: number) => {
      if (pipWindow && !pipWindow.closed && typeof pipWindow.resizeTo === 'function') {
        try {
          pipWindow.resizeTo(width, height);
        } catch {
          // Some OS window managers constrain programmatic resizeTo
        }
      }
    },
    [pipWindow]
  );

  useEffect(() => {
    return () => {
      if (pipWindow && !pipWindow.closed) {
        pipWindow.close();
      }
    };
  }, [pipWindow]);

  return {
    isSupported,
    isOpen: !!pipWindow && !pipWindow.closed,
    pipWindow,
    pipContainer,
    openPiP,
    closePiP,
    resizePiP,
  };
}
