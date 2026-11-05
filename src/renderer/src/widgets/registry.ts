// Every widget the dock can show, in the order the picker lists them.
import type { WidgetDef } from "./types";
import { appsWidget } from "../dock/Apps";
import { fileWidgets } from "./files";
import { clockWidgets } from "./clocks";
import { calendarWidgets } from "./calendar";
import { productivityWidgets } from "./productivity";
import { systemWidgets } from "./system";
import { mediaWidgets } from "./media";
import { aiWidgets } from "./ai";
import { moneyWidgets } from "./money";
import { weatherWidgets } from "./weather";
import { accountWidgets } from "./accounts";
import { extraWidgets } from "./extras";
import { trayWidgets } from "./tray";

export const WIDGETS: WidgetDef[] = [
  appsWidget,
  ...fileWidgets,
  ...clockWidgets,
  ...calendarWidgets,
  ...productivityWidgets,
  ...systemWidgets,
  ...trayWidgets,
  ...mediaWidgets,
  ...aiWidgets,
  ...moneyWidgets,
  ...accountWidgets,
  ...extraWidgets,
  ...weatherWidgets,
];

export const widgetByType = new Map(WIDGETS.map((w) => [w.type, w]));
