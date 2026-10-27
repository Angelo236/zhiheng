export {};

declare global {
  interface Window {
    zhiheng?: {
    getConfig: () => Promise<{ token: string; apiBase: string }>;
    saveKey: (apiKey: string) => Promise<{ hasKey: boolean }>;
      notify: (title: string, body: string) => void;
    };
  }
}
