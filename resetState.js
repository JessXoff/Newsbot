import { emptyState, saveState } from "./state.js";

await saveState(emptyState());
console.log("state.json reset for a fresh deployment.");
