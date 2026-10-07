// Rich Chat Phase 1 — the composer's emoji set. A curated, categorized list rather than a picker
// dependency: the full Unicode catalog (and its ~400 kB of data) is far more than workplace chat
// needs. Each entry is [emoji, search keywords]. Composer emoji are INSERTED AS TEXT — this list has
// nothing to do with the message-reaction allowlist (REACTION_EMOJIS / ALLOWED_REACTION_EMOJIS).
export type EmojiEntry = readonly [emoji: string, keywords: string];

export interface EmojiCategory {
  id: string;
  label: string;
  /** Tab face. */
  icon: string;
  emojis: readonly EmojiEntry[];
}

export const EMOJI_CATEGORIES: readonly EmojiCategory[] = [
  {
    id: "smileys",
    label: "Smileys",
    icon: "😀",
    emojis: [
      ["😀", "grin smile happy"], ["😃", "smile happy joy"], ["😄", "smile laugh happy"],
      ["😁", "grin beam"], ["😆", "laugh squint"], ["😅", "sweat smile relief"],
      ["😂", "joy tears laugh lol"], ["🤣", "rofl rolling laugh"], ["🙂", "slight smile"],
      ["😉", "wink"], ["😊", "blush smile"], ["😇", "angel innocent halo"],
      ["🥰", "love hearts adore"], ["😍", "heart eyes love"], ["🤩", "star struck wow"],
      ["😘", "kiss blow"], ["😋", "yum tasty"], ["😜", "wink tongue silly"],
      ["🤪", "zany crazy"], ["🤗", "hug hugging"], ["🤭", "oops giggle"],
      ["🤫", "shush quiet secret"], ["🤔", "thinking hmm"], ["🤨", "raised eyebrow skeptical"],
      ["😐", "neutral meh"], ["😑", "expressionless"], ["😶", "no mouth speechless"],
      ["🙄", "eye roll"], ["😏", "smirk"], ["😬", "grimace awkward"],
      ["😌", "relieved calm"], ["😔", "pensive sad"], ["😪", "sleepy"],
      ["😴", "sleeping tired zzz"], ["😷", "mask sick"], ["🤒", "thermometer sick ill"],
      ["🥵", "hot heat"], ["🥶", "cold freezing"], ["🥳", "party celebrate birthday"],
      ["😎", "cool sunglasses"], ["🤓", "nerd geek"], ["🧐", "monocle inspect"],
      ["😕", "confused"], ["😟", "worried"], ["😮", "open mouth wow surprised"],
      ["😲", "astonished shocked"], ["🥺", "pleading puppy eyes"], ["😢", "cry sad tear"],
      ["😭", "sob crying"], ["😱", "scream fear"], ["😤", "triumph huff"],
      ["😡", "angry mad rage"], ["🤯", "mind blown exploding"], ["😳", "flushed embarrassed"],
      ["🫡", "salute"], ["🫠", "melting"],
    ],
  },
  {
    id: "people",
    label: "People",
    icon: "👋",
    emojis: [
      ["👋", "wave hello hi bye"], ["🤚", "raised back hand"], ["✋", "raised hand high five"],
      ["👌", "ok okay perfect"], ["🤌", "pinched fingers"], ["✌️", "victory peace"],
      ["🤞", "fingers crossed luck"], ["🤟", "love you gesture"], ["🤘", "rock on horns"],
      ["🤙", "call me shaka"], ["👈", "point left"], ["👉", "point right"],
      ["👆", "point up"], ["👇", "point down"], ["☝️", "index up"],
      ["👍", "thumbs up yes like approve"], ["👎", "thumbs down no dislike"], ["✊", "fist raised"],
      ["👊", "fist bump punch"], ["👏", "clap applause"], ["🙌", "raising hands hooray"],
      ["👐", "open hands"], ["🤝", "handshake deal"], ["🙏", "pray thanks please"],
      ["✍️", "writing"], ["💪", "muscle strong flex"], ["🧠", "brain smart"],
      ["👀", "eyes look see"], ["🧑‍💻", "technologist developer coder"], ["🙋", "raising hand question"],
      ["🤷", "shrug dunno"], ["🤦", "facepalm"], ["🙆", "ok gesture"],
      ["💁", "tipping hand info"], ["🏃", "running hurry"], ["🧘", "yoga calm zen"],
    ],
  },
  {
    id: "nature",
    label: "Animals & Nature",
    icon: "🐶",
    emojis: [
      ["🐶", "dog puppy"], ["🐱", "cat kitten"], ["🐭", "mouse"], ["🐰", "rabbit bunny"],
      ["🦊", "fox"], ["🐻", "bear"], ["🐼", "panda"], ["🐨", "koala"],
      ["🐯", "tiger"], ["🦁", "lion"], ["🐸", "frog"], ["🐵", "monkey"],
      ["🐔", "chicken"], ["🐧", "penguin"], ["🐦", "bird"], ["🦜", "parrot bird"],
      ["🦉", "owl"], ["🐝", "bee busy"], ["🦋", "butterfly"], ["🐢", "turtle slow"],
      ["🐙", "octopus"], ["🐬", "dolphin"], ["🐳", "whale"], ["🦄", "unicorn"],
      ["🌸", "cherry blossom flower"], ["🌻", "sunflower"], ["🌹", "rose flower"], ["🌱", "seedling grow"],
      ["🌴", "palm tree"], ["🍀", "clover luck"], ["🍁", "maple leaf autumn"], ["🌈", "rainbow"],
      ["☀️", "sun sunny"], ["⛅", "cloud sun"], ["🌧️", "rain"], ["⛈️", "storm thunder"],
      ["❄️", "snow snowflake"], ["🔥", "fire lit hot"], ["🌊", "wave ocean"], ["⭐", "star"],
      ["🌙", "moon night"], ["⚡", "lightning zap"],
    ],
  },
  {
    id: "food",
    label: "Food & Drink",
    icon: "🍕",
    emojis: [
      ["🍎", "apple"], ["🍌", "banana"], ["🍇", "grapes"], ["🍓", "strawberry"],
      ["🍉", "watermelon"], ["🍑", "peach"], ["🥑", "avocado"], ["🌶️", "hot pepper spicy"],
      ["🍞", "bread"], ["🥐", "croissant"], ["🧀", "cheese"], ["🍳", "egg cooking breakfast"],
      ["🥓", "bacon"], ["🍔", "burger hamburger"], ["🍟", "fries"], ["🍕", "pizza"],
      ["🌮", "taco"], ["🌯", "burrito"], ["🍜", "noodles ramen"], ["🍣", "sushi"],
      ["🍱", "bento"], ["🍚", "rice"], ["🥗", "salad"], ["🍿", "popcorn"],
      ["🍩", "donut doughnut"], ["🍪", "cookie"], ["🎂", "cake birthday"], ["🍰", "cake slice"],
      ["🍫", "chocolate"], ["🍦", "ice cream"], ["☕", "coffee tea hot"], ["🍵", "tea"],
      ["🧋", "bubble tea boba"], ["🥤", "soda drink cup"], ["🍺", "beer"], ["🍻", "cheers beers"],
      ["🥂", "champagne toast cheers"], ["🍷", "wine"],
    ],
  },
  {
    id: "activity",
    label: "Activities & Objects",
    icon: "🎉",
    emojis: [
      ["🎉", "party popper tada celebrate"], ["🎊", "confetti"], ["🎈", "balloon"], ["🎁", "gift present"],
      ["🏆", "trophy win award"], ["🥇", "gold medal first"], ["🎯", "target goal bullseye"], ["🎮", "game controller"],
      ["🎲", "dice game"], ["🎵", "music note"], ["🎧", "headphones music"], ["🎤", "microphone sing"],
      ["⚽", "soccer football"], ["🏀", "basketball"], ["🎾", "tennis"], ["🏓", "ping pong"],
      ["💻", "laptop computer"], ["🖥️", "desktop computer"], ["⌨️", "keyboard"], ["🖱️", "mouse computer"],
      ["📱", "phone mobile"], ["📞", "telephone call"], ["📷", "camera photo"], ["💡", "idea light bulb"],
      ["📌", "pin pushpin"], ["📎", "paperclip attach"], ["📝", "memo note write"], ["📅", "calendar date"],
      ["📊", "chart bar stats"], ["📈", "chart up growth"], ["📉", "chart down"], ["🗂️", "folder dividers"],
      ["📦", "package box ship"], ["✉️", "email envelope"], ["🔔", "bell notification"], ["🔒", "lock secure"],
      ["🔑", "key"], ["🛠️", "tools build fix"], ["⚙️", "gear settings"], ["🧪", "test tube experiment"],
      ["🚀", "rocket launch ship"], ["✈️", "airplane travel"], ["🚗", "car"], ["🏠", "house home"],
      ["🏢", "office building"], ["⏰", "alarm clock time"], ["⏳", "hourglass wait"], ["💰", "money bag"],
    ],
  },
  {
    id: "symbols",
    label: "Symbols",
    icon: "❤️",
    emojis: [
      ["❤️", "red heart love"], ["🧡", "orange heart"], ["💛", "yellow heart"], ["💚", "green heart"],
      ["💙", "blue heart"], ["💜", "purple heart"], ["🖤", "black heart"], ["🤍", "white heart"],
      ["💔", "broken heart"], ["💯", "hundred perfect"], ["✅", "check done yes"], ["☑️", "check box"],
      ["✔️", "check mark"], ["❌", "cross no wrong"], ["❗", "exclamation important"], ["❓", "question"],
      ["⚠️", "warning caution"], ["🚫", "prohibited no"], ["⭕", "circle"], ["🔴", "red circle"],
      ["🟢", "green circle"], ["🟡", "yellow circle"], ["🔵", "blue circle"], ["✨", "sparkles shiny"],
      ["💫", "dizzy star"], ["💥", "boom collision"], ["💬", "speech bubble chat"], ["💭", "thought bubble"],
      ["🆗", "ok button"], ["🆕", "new"], ["🔝", "top"], ["➕", "plus add"],
      ["➖", "minus"], ["➡️", "right arrow"], ["⬅️", "left arrow"], ["🔁", "repeat"],
    ],
  },
];

export const ALL_EMOJIS: readonly EmojiEntry[] = EMOJI_CATEGORIES.flatMap((c) => c.emojis);
