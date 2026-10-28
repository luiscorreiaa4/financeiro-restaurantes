import { z } from "zod";

/** Data de negócio: "YYYY-MM-DD", sem hora. Nunca passar por `new Date("YYYY-MM-DD")`. */
export type BusinessDate = string;

const dateSchema = z.iso.date();
const uuidV7Schema = z.uuidv7();

export function isBusinessDate(value: string): boolean {
  return dateSchema.safeParse(value).success;
}

export function isUuidV7(value: string): boolean {
  return uuidV7Schema.safeParse(value).success;
}
