import { textTask } from "./text";
import type { Selection } from "../options";
export const note = (
  text: string,
  options: Selection,
  key: string,
  model: string,
) => textTask(text, { ...options, task: "note" }, key, model);
