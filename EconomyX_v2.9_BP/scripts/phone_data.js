/**
 * ============================================================
 *  EconomyX — phone catalogue (GENERATED)
 *  26 colourways across 9 handsets. Every phone costs the same;
 *  the price is the barrier, the model is pure choice.
 * ============================================================
 *  Regenerate rather than hand-edit: the ids here must stay in
 *  lockstep with BP/items/phones/, RP/attachables/ and the
 *  ex_phone_* keys in RP/textures/item_texture.json.
 * ============================================================
 */

/** Universal price, in UD, for every phone in the catalogue. */
export const PHONE_PRICE = 4050;

export const PHONES = [
  // Apple
  { id: "ex:phone_iphone_17_pro_max_deep_blue", name: "iPhone 17 Pro Max — Deep Blue", brand: "Apple" },
  { id: "ex:phone_iphone_17_pro_max_cosmic_orange", name: "iPhone 17 Pro Max — Cosmic Orange", brand: "Apple" },
  { id: "ex:phone_iphone_17_pro_max_silver", name: "iPhone 17 Pro Max — Silver", brand: "Apple" },
  // Samsung
  { id: "ex:phone_samsung_s26_ultra_black", name: "Samsung Galaxy S26 Ultra — Black", brand: "Samsung" },
  { id: "ex:phone_samsung_s26_ultra_cobalt_violet", name: "Samsung Galaxy S26 Ultra — Cobalt Violet", brand: "Samsung" },
  { id: "ex:phone_samsung_s26_ultra_silver_shadow", name: "Samsung Galaxy S26 Ultra — Silver Shadow", brand: "Samsung" },
  // OPPO
  { id: "ex:phone_oppo_find_x9_ultra_tundra_umber", name: "OPPO Find X9 Ultra — Tundra Umber", brand: "OPPO" },
  { id: "ex:phone_oppo_find_x9_ultra_canyon_orange", name: "OPPO Find X9 Ultra — Canyon Orange", brand: "OPPO" },
  { id: "ex:phone_oppo_find_x9_ultra_polar_glacier", name: "OPPO Find X9 Ultra — Polar Glacier", brand: "OPPO" },
  // vivo
  { id: "ex:phone_vivo_x300_ultra_black", name: "vivo X300 Ultra — Black", brand: "vivo" },
  { id: "ex:phone_vivo_x300_ultra_victory_green", name: "vivo X300 Ultra — Victory Green", brand: "vivo" },
  { id: "ex:phone_vivo_x300_ultra_white", name: "vivo X300 Ultra — White", brand: "vivo" },
  // vivo
  { id: "ex:phone_vivo_x500_black", name: "vivo X500 — Black", brand: "vivo" },
  { id: "ex:phone_vivo_x500_white", name: "vivo X500 — White", brand: "vivo" },
  { id: "ex:phone_vivo_x500_blue", name: "vivo X500 — Blue", brand: "vivo" },
  // HONOR
  { id: "ex:phone_honor_magic9_pro_max_moss_green", name: "HONOR Magic9 Pro Max — Moss Green", brand: "HONOR" },
  { id: "ex:phone_honor_magic9_pro_max_black", name: "HONOR Magic9 Pro Max — Black", brand: "HONOR" },
  { id: "ex:phone_honor_magic9_pro_max_white", name: "HONOR Magic9 Pro Max — White", brand: "HONOR" },
  // Huawei
  { id: "ex:phone_huawei_mate_80_pro_obsidian_black", name: "Huawei Mate 80 Pro — Obsidian Black", brand: "Huawei" },
  { id: "ex:phone_huawei_mate_80_pro_spruce_green", name: "Huawei Mate 80 Pro — Spruce Green", brand: "Huawei" },
  { id: "ex:phone_huawei_mate_80_pro_dawn_gold", name: "Huawei Mate 80 Pro — Dawn Gold", brand: "Huawei" },
  // Nothing
  { id: "ex:phone_nothing_phone_4a_pro_black", name: "Nothing Phone (4a) Pro — Black", brand: "Nothing" },
  { id: "ex:phone_nothing_phone_4a_pro_silver", name: "Nothing Phone (4a) Pro — Silver", brand: "Nothing" },
  { id: "ex:phone_nothing_phone_4a_pro_pink", name: "Nothing Phone (4a) Pro — Pink", brand: "Nothing" },
  // RedMagic
  { id: "ex:phone_redmagic_11s_pro_nightfreeze", name: "RedMagic 11S Pro — Nightfreeze", brand: "RedMagic" },
  { id: "ex:phone_redmagic_11s_pro_subzero", name: "RedMagic 11S Pro — Subzero", brand: "RedMagic" },
];

/** Fast id -> catalogue entry lookup. */
export const PHONE_BY_ID = new Map(PHONES.map((p) => [p.id, p]));

/** Every phone id, for the mob guard and the creative-only check. */
export const PHONE_IDS = PHONES.map((p) => p.id);
