import { createContext, useContext, type FC, type ReactNode } from "react";
import type { WidgetInstance } from "@shared/types";

export type Category =
  | "Clocks"
  | "Productivity"
  | "System"
  | "Media & Audio"
  | "AI"
  | "Developer"
  | "Finance"
  | "Analytics"
  | "Social"
  | "Online & Mail"
  | "Apps & Files"
  | "Weather"
  | "Stocks";

export const CATEGORIES: Category[] = ["Apps & Files", "Clocks", "Productivity", "System", "Media & Audio", "AI", "Developer", "Finance", "Analytics", "Social", "Online & Mail", "Weather", "Stocks"];

export interface TileProps {
  inst: WidgetInstance;
  preview?: boolean;
}

export interface CardProps {
  inst: WidgetInstance;
  close: () => void;
}

export interface MenuItem {
  label?: string;
  icon?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  checked?: boolean;
  disabled?: boolean;
  separator?: boolean;
}

export interface WidgetDef {
  type: string;
  name: string;
  category: Category;
  description: string;
  Tile: FC<TileProps>;
  Card?: FC<CardProps>;
  cardWidth?: number;
  /** the card has text fields and needs the keyboard */
  cardFocus?: boolean;
  /** draws its own background instead of the standard tile */
  plain?: boolean;
  /** a click does this instead of opening a card */
  action?: (inst: WidgetInstance) => void;
  menu?: (inst: WidgetInstance) => MenuItem[];
  /** only one per dock */
  single?: boolean;
  /** shown in the picker but needs an account first */
  account?: string;
}

export interface DockApi {
  edge: "top" | "bottom";
  preview: boolean;
  light: boolean;
  openCard: (uid: string, anchor: HTMLElement, content?: ReactNode, opts?: { width?: number; focus?: boolean; hover?: boolean; padding?: number }) => void;
  /** a hover card stays while the pointer is on its tile or on the card */
  hoverCard: (inside: boolean) => void;
  closeCard: () => void;
  cardUid: string | null;
  openMenu: (at: { x: number; y: number }, items: MenuItem[]) => void;
  /** dragging something: clicks right after a drag are not clicks */
  justDragged: () => boolean;
  markDragged: () => void;
  /** tile height in px */
  tile: number;
}

export const DockContext = createContext<DockApi>({
  edge: "bottom",
  preview: true,
  light: false,
  openCard: () => {},
  hoverCard: () => {},
  closeCard: () => {},
  cardUid: null,
  openMenu: () => {},
  justDragged: () => false,
  markDragged: () => {},
  tile: 44,
});

export const useDock = () => useContext(DockContext);
