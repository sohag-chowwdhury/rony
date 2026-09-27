import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import FirebaseGate from "./FirebaseGate";

import "./styles.css";
import "./dark.css";
import "./migration.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>

    <FirebaseGate><App /></FirebaseGate>
  </StrictMode>,
);
