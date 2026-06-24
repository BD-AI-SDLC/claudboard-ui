import { z } from 'zod'

export const stubbableString = z.union([z.string().min(1), z.literal('__stub__')])
