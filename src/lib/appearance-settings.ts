export type SiteAnnouncement = {
  id?: string;
  name?: string;
  enabled: boolean;
  text: string;
  sortOrder?: number;
  href?: string;
  startAt?: string;
  endAt?: string;
};

export type SiteBanner = {
  id: string;
  name: string;
  desktopImageUrl: string;
  mobileImageUrl?: string;
  href?: string;
  enabled: boolean;
  sortOrder: number;
  startAt?: string;
  endAt?: string;
};

export type HomepageSection = {
  id: string;
  enabled: boolean;
  title: string;
  sortOrder: number;
  maxItems: number;
};

export type SiteNavigationItem = {
  key: string;
  label: string;
  href: string;
  enabled: boolean;
  locked?: boolean;
  sortOrder: number;
};

export type SiteInfo = {
  instagramUrl: string;
  lineUrl: string;
  contactEmail?: string;
  description?: string;
  faviconUrl?: string;
  ogImageUrl?: string;
  faviconPublicId?: string;
  ogImagePublicId?: string;
};

export type AppearanceSettings = {
  announcement: SiteAnnouncement;
  announcements: SiteAnnouncement[];
  banners: SiteBanner[];
  homepageSections: HomepageSection[];
  navigationItems: SiteNavigationItem[];
  siteInfo: SiteInfo;
};

type ScheduleSettingRow = {
  type: string | null;
  image: string | null;
  updated_at: string | null;
};

const DEFAULT_ANNOUNCEMENT: SiteAnnouncement = {
  enabled: true,
  text: "東京連線與現貨選物同步更新，滿 NT$1,100 可免運。",
};

const DEFAULT_HOMEPAGE_SECTIONS: HomepageSection[] = [
  { id: "category_shortcuts", enabled: true, title: "分類捷徑", sortOrder: 0, maxItems: 8 },
  { id: "latest", enabled: true, title: "最新上架", sortOrder: 1, maxItems: 6 },
  { id: "stock", enabled: true, title: "現貨商品", sortOrder: 2, maxItems: 6 },
  { id: "preorder", enabled: true, title: "預購商品", sortOrder: 3, maxItems: 6 },
  { id: "guide", enabled: true, title: "購物流程", sortOrder: 4, maxItems: 5 },
];

export const DEFAULT_SITE_NAVIGATION: SiteNavigationItem[] = [
  { key: "home", label: "首頁", href: "/", enabled: true, locked: true, sortOrder: 0 },
  { key: "products", label: "全部商品", href: "/products", enabled: true, sortOrder: 1 },
  { key: "preorder", label: "預購商品", href: "/category/preorder", enabled: true, sortOrder: 2 },
  { key: "stock", label: "現貨", href: "/category/in_stock", enabled: true, sortOrder: 3 },
  { key: "live_order", label: "連線 / 擺攤", href: "/category/live_order", enabled: true, sortOrder: 4 },
  { key: "guide", label: "購物須知", href: "/guide", enabled: true, sortOrder: 5 },
  { key: "faq", label: "FAQ", href: "/faq", enabled: true, sortOrder: 6 },
  { key: "contact", label: "聯絡小企鵝", href: "/contact", enabled: true, sortOrder: 7 },
];

const DEFAULT_SITE_INFO: SiteInfo = {
  instagramUrl: "https://www.instagram.com/pinkkkuin.jp/",
  lineUrl: "https://line.me/R/ti/p/@pinkkkuin",
  description: "專門收集日本限定、可愛雜貨、角色周邊與現貨選物。",
};

function supabaseHeaders() {
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "").trim();
  if (!process.env.SUPABASE_URL?.trim() || !key) return null;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
}

function safeJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function isWithinSchedule(startAt?: string, endAt?: string) {
  const now = Date.now();
  const start = startAt ? new Date(startAt).getTime() : Number.NaN;
  const end = endAt ? new Date(endAt).getTime() : Number.NaN;
  if (Number.isFinite(start) && now < start) return false;
  if (Number.isFinite(end) && now > end) return false;
  return true;
}

function normalizeAnnouncementList(row?: ScheduleSettingRow): SiteAnnouncement[] {
  const parsed = safeJson<Record<string, unknown>>(row?.image || null, {});
  const sourceList = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.announcements)
      ? parsed.announcements
      : parsed.text || parsed.enabled !== undefined
        ? [parsed]
        : [DEFAULT_ANNOUNCEMENT];

  return sourceList
    .map((item, index) => {
      const source = item as Record<string, unknown>;
      const startAt = String(source.start_at || source.startAt || "").trim() || undefined;
      const endAt = String(source.end_at || source.endAt || "").trim() || undefined;
      const enabled = source.enabled === undefined ? DEFAULT_ANNOUNCEMENT.enabled : source.enabled === true;
      return {
        id: String(source.id || `announcement-${index}`),
        name: String(source.name || source.note || "").trim() || undefined,
        enabled: enabled && isWithinSchedule(startAt, endAt),
        text: String(source.text || DEFAULT_ANNOUNCEMENT.text).trim(),
        href: String(source.href || source.link || "").trim() || undefined,
        sortOrder: Number(source.sort_order ?? source.sortOrder ?? index),
        startAt,
        endAt,
      } satisfies SiteAnnouncement;
    })
    .filter((announcement) => announcement.enabled && Boolean(announcement.text))
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
}

function normalizeAnnouncement(row?: ScheduleSettingRow): SiteAnnouncement {
  return normalizeAnnouncementList(row)[0] || { ...DEFAULT_ANNOUNCEMENT, enabled: false };
}

function normalizeBanners(row?: ScheduleSettingRow): SiteBanner[] {
  const parsed = safeJson<Record<string, unknown>>(row?.image || null, {});
  const banners = Array.isArray(parsed.banners) ? parsed.banners : [];
  return banners
    .map((item, index) => {
      const source = item as Record<string, unknown>;
      const desktopImageUrl = String(source.desktop_image_url || source.desktopImageUrl || source.image || "").trim();
      if (!desktopImageUrl) return null;
      return {
        id: String(source.id || `banner-${index}`),
        name: String(source.name || `Banner ${index + 1}`),
        desktopImageUrl,
        mobileImageUrl: String(source.mobile_image_url || source.mobileImageUrl || "").trim() || undefined,
        href: String(source.href || source.link || "").trim() || undefined,
        enabled: source.enabled !== false,
        sortOrder: Number(source.sort_order ?? source.sortOrder ?? index),
        startAt: String(source.start_at || source.startAt || "").trim() || undefined,
        endAt: String(source.end_at || source.endAt || "").trim() || undefined,
      } satisfies SiteBanner;
    })
    .filter((banner): banner is NonNullable<typeof banner> => Boolean(banner))
    .filter((banner) => banner.enabled && isWithinSchedule(banner.startAt, banner.endAt))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

function normalizeHomepageSections(row?: ScheduleSettingRow): HomepageSection[] {
  const parsed = safeJson<Record<string, unknown>>(row?.image || null, {});
  const sections = Array.isArray(parsed.sections) ? parsed.sections : [];
  const merged = new Map(DEFAULT_HOMEPAGE_SECTIONS.map((section) => [section.id, section]));
  sections.forEach((item, index) => {
    const source = item as Record<string, unknown>;
    const id = String(source.id || "").trim();
    if (!id) return;
    const base = merged.get(id) || { id, enabled: true, title: id, sortOrder: index, maxItems: 6 };
    merged.set(id, {
      id,
      enabled: source.enabled === undefined ? base.enabled : source.enabled === true,
      title: String(source.title || base.title).trim(),
      sortOrder: Number(source.sort_order ?? source.sortOrder ?? base.sortOrder),
      maxItems: Math.max(1, Math.min(24, Number(source.max_items ?? source.maxItems ?? base.maxItems) || base.maxItems)),
    });
  });
  return Array.from(merged.values()).sort((a, b) => a.sortOrder - b.sortOrder);
}

function normalizeNavigationItems(row?: ScheduleSettingRow): SiteNavigationItem[] {
  const parsed = safeJson<Record<string, unknown>>(row?.image || null, {});
  const sourceItems = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.items)
      ? parsed.items
      : [];
  const merged = new Map(DEFAULT_SITE_NAVIGATION.map((item) => [item.key, { ...item }]));
  sourceItems.forEach((item, index) => {
    const source = item as Record<string, unknown>;
    const key = String(source.key || "").trim();
    const fallback = merged.get(key);
    if (!fallback) return;
    merged.set(key, {
      ...fallback,
      label: String(source.label || fallback.label).trim() || fallback.label,
      href: fallback.href,
      enabled: fallback.locked ? true : source.enabled === undefined ? fallback.enabled : source.enabled === true,
      locked: fallback.locked,
      sortOrder: fallback.locked ? 0 : Number(source.sort_order ?? source.sortOrder ?? index),
    });
  });
  const items = Array.from(merged.values()).sort((a, b) => a.sortOrder - b.sortOrder);
  const home = items.find((item) => item.key === "home") || DEFAULT_SITE_NAVIGATION[0];
  const rest = items.filter((item) => item.key !== "home");
  return [
    { ...home, enabled: true, locked: true, sortOrder: 0 },
    ...rest.map((item, index) => ({ ...item, sortOrder: index + 1 })),
  ];
}

function normalizeSiteInfo(row?: ScheduleSettingRow): SiteInfo {
  const parsed = safeJson<Record<string, unknown>>(row?.image || null, {});
  return {
    instagramUrl: String(parsed.instagram_url || parsed.instagramUrl || DEFAULT_SITE_INFO.instagramUrl).trim(),
    lineUrl: String(parsed.line_url || parsed.lineUrl || DEFAULT_SITE_INFO.lineUrl).trim(),
    contactEmail: String(parsed.contact_email || parsed.contactEmail || "").trim() || undefined,
    description: String(parsed.description || DEFAULT_SITE_INFO.description || "").trim(),
    faviconUrl: String(parsed.favicon_url || parsed.faviconUrl || "").trim() || undefined,
    ogImageUrl: String(parsed.og_image_url || parsed.ogImageUrl || "").trim() || undefined,
    faviconPublicId: String(parsed.favicon_public_id || parsed.faviconPublicId || "").trim() || undefined,
    ogImagePublicId: String(parsed.og_image_public_id || parsed.ogImagePublicId || "").trim() || undefined,
  };
}

export function isAnnouncementVisible(announcement: SiteAnnouncement) {
  return announcement.enabled && Boolean(announcement.text) && isWithinSchedule(announcement.startAt, announcement.endAt);
}

export async function getAppearanceSettings(): Promise<AppearanceSettings> {
  const headers = supabaseHeaders();
  const baseUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  if (!headers || !baseUrl) {
    return {
      announcement: DEFAULT_ANNOUNCEMENT,
      announcements: [DEFAULT_ANNOUNCEMENT],
      banners: [],
      homepageSections: DEFAULT_HOMEPAGE_SECTIONS,
      navigationItems: DEFAULT_SITE_NAVIGATION,
      siteInfo: DEFAULT_SITE_INFO,
    };
  }

  try {
    const response = await fetch(
      `${baseUrl}/rest/v1/schedule_settings?select=type,image,updated_at&type=in.(site-announcements,site-banners,homepage-sections,site-navigation,site-info)&order=updated_at.desc`,
      { headers, cache: "no-store" },
    );
    if (!response.ok) throw new Error(`Supabase appearance settings fetch failed (${response.status})`);
    const rows = (await response.json()) as ScheduleSettingRow[];
    const announcements = normalizeAnnouncementList(rows.find((row) => row.type === "site-announcements"));
    return {
      announcement: announcements[0] || { ...DEFAULT_ANNOUNCEMENT, enabled: false },
      announcements,
      banners: normalizeBanners(rows.find((row) => row.type === "site-banners")),
      homepageSections: normalizeHomepageSections(rows.find((row) => row.type === "homepage-sections")),
      navigationItems: normalizeNavigationItems(rows.find((row) => row.type === "site-navigation")),
      siteInfo: normalizeSiteInfo(rows.find((row) => row.type === "site-info")),
    };
  } catch (error) {
    console.warn("Appearance settings fetch failed", error);
    return {
      announcement: DEFAULT_ANNOUNCEMENT,
      announcements: [DEFAULT_ANNOUNCEMENT],
      banners: [],
      homepageSections: DEFAULT_HOMEPAGE_SECTIONS,
      navigationItems: DEFAULT_SITE_NAVIGATION,
      siteInfo: DEFAULT_SITE_INFO,
    };
  }
}
