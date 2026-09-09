import { textTask } from "./text";
import type { Selection } from "../options";
export const meeting = (
  text: string,
  options: Selection,
  key: string,
  model: string,
) => textTask(text, { ...options, task: "meeting" }, key, model);
