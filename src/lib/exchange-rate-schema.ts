import { z } from "zod";

export const exchangeRateSchema = z.object({
  rateDate: z.iso.date(),
  fromCurrency: z.enum(["HTG", "USD"]),
  toCurrency: z.enum(["HTG", "USD"]),
  rate: z.string().regex(/^\d{1,10}(?:\.\d{1,8})?$/).refine((value) => Number(value) > 0),
}).strict().refine((data) => data.fromCurrency !== data.toCurrency);
