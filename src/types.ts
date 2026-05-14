/** Shared TypeScript types — see ../navily-kb/.napkin/specs/navily-api-architecture.md. */

export interface Coordinate {
  latitude: number;
  longitude: number;
}

export interface Media {
  id: number;
  mime: string;
  url: string;
  size?: { width: number; height: number };
  ratio?: number;
  sizes?: number[];
  counts?: { likes: number; dislikes: number };
  permissions?: { remove: 0 | 1; like: 0 | 1; dislike: 0 | 1; report: 0 | 1 };
  createdAt?: string;
}

export type Kind = "port" | "mooring" | "region" | "user" | "shop";

export interface MapSearchResult {
  id: number;
  kind: "mooring" | "port";
  type: string;
  name: string;
  protections: string[];
  seabeds: string[];
  bookable: boolean;
  isMaster: boolean;
  coordinate: Coordinate;
  distance: number;
  regionName: string;
  timezone: string;
  rating: number;
  hasDock: boolean;
  hasHawser: boolean;
  hasMooringBuoy: boolean;
  authorizeAnchor: boolean;
  hasPontoon: boolean;
  hasBeach: boolean;
  hasShop: boolean;
  hasWaterSource: boolean;
  alert: unknown | null;
  media: Media | null;
  counts: { likes: number; comments: number };
  url: string;
  picture: string;
}

export interface SessionData {
  status: boolean;
  name: string;
  phone: string | null;
  email: string;
  avatar: string;
}

export interface User {
  id: number;
  firstName: string;
  lastName?: string;
  email?: string;
  avatar: string | null;
  contributorScore: number;
  topContributor: boolean;
  itineraryAllowed: boolean;
  reporter: boolean;
  alert: unknown | null;
  boat: unknown | null;
  counts: { boats?: number; moorings: number; comments?: number };
  createdAt?: string;
  updatedAt?: string;
  description?: string | null;
  nationality?: string | null;
  configuration?: {
    language: string;
    advertisable: boolean;
    currency: string;
    [k: string]: unknown;
  };
}

export interface Country {
  id: number;
  code: string;
  callingCode: string;
  name: string;
  emergencyPhone: string | null;
  vhf: number;
  flag: string;
}

export interface Paginated<T> {
  data: T[];
  links: { first: string; last: string; prev: string | null; next: string | null };
  meta: {
    current_page: number;
    last_page: number;
    from: number | null;
    to: number | null;
    total?: number;
    path: string;
    per_page?: number;
    links: { url: string | null; label: string; active: boolean }[];
  };
}

export interface Equipment {
  key: string;
  name: string;
  icon: string;
  cost: "included" | "free" | null;
  access: "controlled" | "24" | null;
  value: number | null;
  details: string[] | null;
  isAvailable: boolean;
}

export interface PriceTonight {
  status: string;
  result: {
    priceTonight: number;
    currency: string;
    priceNightWithCurrency: string;
  };
}
