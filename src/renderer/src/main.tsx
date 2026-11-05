// One page for every window; the hash says which: the dock, Settings or the widget picker.
import "./styles.css";
import { StrictMode, Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { initState } from "./lib/state";
import { Dock } from "./dock/Dock";

// the dock never loads Settings or the picker: their code arrives only in their own windows
const Picker = lazy(() => import("./windows/Picker").then((m) => ({ default: m.Picker })));
const SettingsWindow = lazy(() => import("./windows/Settings").then((m) => ({ default: m.SettingsWindow })));

function parse(hash: string) {
  const [path, query] = hash.replace(/^#\/?/, "").split("?");
  return { path, params: new URLSearchParams(query) };
}

function App() {
  const [route, setRoute] = useState(() => parse(location.hash));
  useEffect(
    () =>
      window.vyse.on("route", (r: string) => {
        history.replaceState(null, "", `#${r}`);
        setRoute(parse(r));
      }),
    [],
  );
  if (route.path === "dock") return <Dock displayId={Number(route.params.get("display"))} />;
  return (
    <Suspense fallback={null}>
      {route.path === "widgets" ? <Picker /> : <SettingsWindow page={route.params.get("page") ?? "appearance"} />}
    </Suspense>
  );
}

void initState().then(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
