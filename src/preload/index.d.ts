import type { VyseApi } from "./index";

declare global {
  interface Window {
    vyse: VyseApi;
  }
}

export {};
