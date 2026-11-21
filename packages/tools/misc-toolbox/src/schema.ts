/**
 * @file CIDR 解析结果的 zod 契约（AGENTS §6：入参/中间结果经 zod 校验后再计算）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 地址用无符号 32 位整数表示，便于位运算；前缀长度限定 0–32
 */
import { z } from 'zod'

/** 无符号 32 位 IPv4 地址（十进制整数形式） */
export const ipv4AddressSchema = z.number().int().min(0).max(0xffffffff)

/** 前缀长度 0–32 */
export const prefixLengthSchema = z.number().int().min(0).max(32)

/** CIDR 解析结果：地址 + 前缀 + 主机位是否非 0（已归一化网络地址） */
export const ipv4CidrSchema = z.object({
  address: ipv4AddressSchema,
  prefix: prefixLengthSchema,
  normalized: z.boolean()
})
