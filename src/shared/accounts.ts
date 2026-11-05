// The services a widget can read with your own key: what each one asks for, in one place for
// the fetchers, the Accounts page and the connect form on each widget's card.

export type ProviderKind = "revenue" | "count" | "balance" | "issues" | "leetcode";

export interface ProviderField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
}

export interface ProviderSpec {
  id: string;
  name: string;
  kind: ProviderKind;
  group: "Finance" | "Analytics" | "Developer" | "Social" | "AI";
  /** the tile's mark: a letter on the service's colour */
  color: string;
  letter: string;
  fields: ProviderField[];
  /** what to create in the service, shown under the fields */
  help: string;
  /** where to create it */
  site: string;
  /** count widgets: what the number counts */
  unit?: string;
}

export const PROVIDERS: ProviderSpec[] = [
  { id: "polar", name: "Polar", kind: "revenue", group: "Finance", color: "#0062ff", letter: "P", fields: [{ key: "token", label: "Access token", placeholder: "polar_oat_...", secret: true }], help: "An organization access token with the metrics:read scope.", site: "https://polar.sh/dashboard" },
  { id: "lemonsqueezy", name: "Lemon Squeezy", kind: "revenue", group: "Finance", color: "#7047eb", letter: "L", fields: [{ key: "key", label: "API key", secret: true }], help: "Settings › API in your Lemon Squeezy dashboard.", site: "https://app.lemonsqueezy.com/settings/api" },
  { id: "paddle", name: "Paddle", kind: "revenue", group: "Finance", color: "#1d2a3a", letter: "P", fields: [{ key: "key", label: "API key", placeholder: "pdl_live_apikey_...", secret: true }], help: "Developer tools › Authentication, with read access to transactions.", site: "https://vendors.paddle.com/authentication-v2" },
  { id: "gumroad", name: "Gumroad", kind: "revenue", group: "Finance", color: "#ff90e8", letter: "G", fields: [{ key: "token", label: "Access token", secret: true }], help: "Settings › Advanced › Applications: create an application and generate an access token.", site: "https://app.gumroad.com/settings/advanced" },
  {
    id: "shopify",
    name: "Shopify",
    kind: "revenue",
    group: "Finance",
    color: "#5e8e3e",
    letter: "S",
    fields: [
      { key: "shop", label: "Store", placeholder: "your-store.myshopify.com" },
      { key: "token", label: "Admin API token", placeholder: "shpat_...", secret: true },
    ],
    help: "A custom app in Settings › Apps and sales channels with the read_orders scope.",
    site: "https://admin.shopify.com",
  },
  { id: "dodo", name: "Dodo Payments", kind: "revenue", group: "Finance", color: "#1f1f1f", letter: "D", fields: [{ key: "key", label: "API key", secret: true }], help: "Developer › API keys in your Dodo Payments dashboard.", site: "https://app.dodopayments.com" },
  {
    id: "plausible",
    name: "Plausible",
    kind: "count",
    group: "Analytics",
    color: "#5850ec",
    letter: "P",
    unit: "visitors this week",
    fields: [
      { key: "site", label: "Site", placeholder: "example.com" },
      { key: "key", label: "Stats API key", secret: true },
    ],
    help: "Account settings › API keys: a Stats API key.",
    site: "https://plausible.io/settings/api-keys",
  },
  { id: "dub", name: "Dub", kind: "count", group: "Analytics", color: "#000000", letter: "D", unit: "clicks this week", fields: [{ key: "key", label: "API key", placeholder: "dub_...", secret: true }], help: "Workspace settings › API keys, with read access to analytics.", site: "https://app.dub.co" },
  { id: "resend", name: "Resend", kind: "count", group: "Developer", color: "#000000", letter: "R", unit: "emails this week", fields: [{ key: "key", label: "API key", placeholder: "re_...", secret: true }], help: "A full-access key: a sending-only key can't list emails.", site: "https://resend.com/api-keys" },
  { id: "linear", name: "Linear", kind: "issues", group: "Developer", color: "#5e6ad2", letter: "L", fields: [{ key: "key", label: "Personal API key", placeholder: "lin_api_...", secret: true }], help: "Settings › Security & access › Personal API keys.", site: "https://linear.app/settings/account/security" },
  {
    id: "youtube",
    name: "YouTube",
    kind: "count",
    group: "Social",
    color: "#ff0033",
    letter: "▶",
    unit: "subscribers",
    fields: [
      { key: "channel", label: "Channel", placeholder: "@handle or UC..." },
      { key: "key", label: "API key", secret: true },
    ],
    help: "A Google Cloud API key with the YouTube Data API v3 turned on.",
    site: "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
  },
  { id: "instagram", name: "Instagram", kind: "count", group: "Social", color: "#e1306c", letter: "I", unit: "followers", fields: [{ key: "token", label: "Access token", secret: true }], help: "An Instagram API token for a professional account (Instagram Login).", site: "https://developers.facebook.com/apps" },
  {
    id: "x",
    name: "X",
    kind: "count",
    group: "Social",
    color: "#000000",
    letter: "X",
    unit: "followers",
    fields: [
      { key: "user", label: "Username", placeholder: "without the @" },
      { key: "token", label: "Bearer token", secret: true },
    ],
    help: "Your app's Bearer token from the X developer portal.",
    site: "https://developer.x.com/en/portal/dashboard",
  },
  { id: "tiktok", name: "TikTok", kind: "count", group: "Social", color: "#111111", letter: "T", unit: "followers", fields: [{ key: "token", label: "User access token", secret: true }], help: "A user access token with the user.info.stats scope.", site: "https://developers.tiktok.com" },
  { id: "deepseek", name: "DeepSeek", kind: "balance", group: "AI", color: "#4d6bfe", letter: "D", fields: [{ key: "key", label: "API key", placeholder: "sk-...", secret: true }], help: "API keys in the DeepSeek platform.", site: "https://platform.deepseek.com/api_keys" },
  { id: "leetcode", name: "LeetCode", kind: "leetcode", group: "Developer", color: "#ffa116", letter: "L", fields: [{ key: "user", label: "Username" }], help: "Your public profile name; no key needed.", site: "https://leetcode.com" },
];

export const providerById = (id: string): ProviderSpec | undefined => PROVIDERS.find((p) => p.id === id);
export const REVENUE_PROVIDERS = PROVIDERS.filter((p) => p.kind === "revenue");

/** the shapes the fetchers publish */
export interface RevenueData {
  kind: "revenue";
  currency: string;
  total: number;
  days: { date: string; value: number }[];
  week: number;
  change: number;
}
export interface CountData {
  kind: "count";
  value: number;
  /** recent days, oldest first, when the service gives them */
  series?: number[];
  change?: number;
  label?: string;
}
export interface BalanceData {
  kind: "balance";
  balance: number;
  currency: string;
  available: boolean;
}
export interface IssuesData {
  kind: "issues";
  issues: { id: string; title: string; state: string; type: string; url: string }[];
}
export interface LeetcodeData {
  kind: "leetcode";
  solved: number;
  easy: number;
  medium: number;
  hard: number;
  streak: number;
  ranking: number | null;
}
export type ProviderData = RevenueData | CountData | BalanceData | IssuesData | LeetcodeData;
