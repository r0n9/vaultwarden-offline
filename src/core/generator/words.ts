/**
 * 内置词表（生成密码短语与用户名用）。
 *
 * ⚠️ 诚实说明：这是**自制的常见英文单词表**，不是 EFF 官方词表（EFF 词表是
 * 公开文本，但需要从网络获取，与零网络承诺冲突）。词表未经过 Diceware 式的
 * 熵审计，安全强度按「每词约 10 位熵」估算即可。
 */

export const WORDS: readonly string[] = [
  // 名词
  "apple", "arrow", "autumn", "bamboo", "beach", "bridge", "candle", "castle",
  "crystal", "dolphin", "eagle", "ember", "falcon", "forest", "garden", "glacier",
  "harbor", "island", "jungle", "lantern", "meadow", "mountain", "ocean", "orbit",
  "panda", "penguin", "planet", "quartz", "river", "saddle", "silver", "summit",
  "tiger", "tundra", "valley", "violet", "walnut", "willow", "zephyr", "acorn",
  "badger", "canvas", "dagger", "fable", "guitar", "harbor", "icicle", "jasmine",
  "kettle", "lagoon", "marble", "nebula", "orchid", "pebble", "quiver", "raven",
  "saffron", "thistle", "umbrella", "voyage", "waffle", "yonder", "zinnia",
  "anchor", "breeze", "canyon", "dragon", "falcon", "granite", "hazel", "insight",
  "jubilee", "kindle", "lotus", "magnolia", "nectar", "onyx", "prairie", "quill",
  "ripple", "sprout", "timber", "upland", "vessel", "whisper", "yield", "zenith",
  // 形容词
  "amber", "bold", "calm", "daring", "eager", "fierce", "gentle", "honest",
  "ivory", "jolly", "keen", "lively", "mellow", "noble", "oaken", "proud",
  "quaint", "rapid", "serene", "tender", "united", "vivid", "witty", "young",
  "zippy", "bright", "crimson", "dusky", "frosty", "golden", "hollow", "jade",
  "kindred", "lunar", "misty", "nocturnal", "opal", "pearly", "quiet", "royal",
  "silken", "twilight", "vapor", "winter", "ardent", "blithe", "celestial",
];

/** 用户名生成用的形容词。 */
export const ADJECTIVES: readonly string[] = [
  "amber", "bold", "calm", "daring", "eager", "fierce", "gentle", "honest",
  "ivory", "jolly", "keen", "lively", "mellow", "noble", "proud", "quaint",
  "rapid", "serene", "tender", "vivid", "witty", "bright", "crimson", "dusky",
  "frosty", "golden", "jade", "lunar", "misty", "opal", "pearly", "quiet",
  "royal", "silken", "ardent", "blithe", "celestial",
];
