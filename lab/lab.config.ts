import { defineLab } from "../src/lib/lab/define.ts";

/**
 * The one file a lab edits (lab config spec 2026-10-25). Everything that makes
 * this deployment the Cornell Tech MakerLAB's: names, logo, colours, hours,
 * people, links, what the assistant knows about the lab, and whether
 * `floor-plan.json` is its map. A fork replaces these values, puts its images
 * in `public/lab/`, and runs `npm run lab:check`. See `lab/README.md`.
 *
 * Committed and partly sent to browsers: no secrets here, and only email
 * addresses the lab publishes itself. Keys, and the individual sign-in
 * addresses (`AUTH_ALLOWED_EMAILS`, `AUTH_SUPER_ADMIN_EMAILS`), stay in
 * environment variables. An environment variable named next to a field below
 * overrides it, so one checkout can serve several deployments.
 *
 * Text marked LocalizedText is a string, or `{ en: "…", es: "…" }`: a locale
 * it does not give reads the English.
 */
export default defineLab({
  identity: {
    siteName: "MakerLAB Tools", // NEXT_PUBLIC_SITE_NAME
    labName: "MakerLAB",
    institution: "Cornell Tech", // NEXT_PUBLIC_INSTITUTION
    tagline: "Your digital guide to making at Cornell Tech", // NEXT_PUBLIC_TAGLINE
    assistantName: "MakerLAB AI", // NEXT_PUBLIC_CHAT_ASSISTANT_NAME
    audience: "students who may be beginners", // AUDIENCE
  },

  brand: {
    // One colour, vector: drawn as a mask in the text colour. Its PNG twin
    // (logo.png) is what QR sheets and the link-preview card use.
    logo: "/lab/logo.svg", // NEXT_PUBLIC_LOGO
    // The lettering alone, for the header ("MakerLAB" + "AI").
    wordmark: "/lab/wordmark.svg", // NEXT_PUBLIC_WORDMARK
    colors: {
      primary: "#ff6b35", // NEXT_PUBLIC_COLOR_PRIMARY
      primaryDark: "#cc4f1f", // NEXT_PUBLIC_COLOR_PRIMARY_DARK
    },
  },

  web: {
    // Where printed QR codes and link previews point. NEXT_PUBLIC_SITE_URL,
    // then Vercel's production domain, win over it.
    siteUrl: "https://www.makerlabai.app",
    // The public repository this deployment's code comes from (AGPL-3.0 §13).
    sourceUrl: "https://github.com/philosophercode/makerlab-tools", // NEXT_PUBLIC_SOURCE_URL
  },

  place: {
    timezone: "America/New_York", // LAB_TIMEZONE
    hours: "LAB OPEN 8AM-8PM", // NEXT_PUBLIC_LAB_HOURS
  },

  access: {
    // Anyone with an address on this domain may sign in.
    // Named exceptions: AUTH_ALLOWED_EMAILS. Bootstrap super admins:
    // AUTH_SUPER_ADMIN_EMAILS. Both env only.
    emailDomain: "cornell.edu", // AUTH_ALLOWED_EMAIL_DOMAIN
  },

  email: {
    // Notifications' sender (a Resend-verified domain); null keeps mail off
    // unless EMAIL_FROM is set.
    from: null, // EMAIL_FROM
    replyTo: null, // EMAIL_REPLY_TO
  },

  contact: {
    // The demo pass thank-you's address; null points to About's contacts.
    demoEmail: "ies22@cornell.edu", // DEMO_PASS_CONTACT_EMAIL ("off" for null)
  },

  locale: {
    default: "en",
  },

  people: [
    { name: "Niti Parikh", title: "Director, Learning Spaces and MakerLABs", email: "ntp27@cornell.edu" },
    { name: "Luis Rodrigo Navarro", title: "Assistant Director", email: "ln328@cornell.edu" },
  ],

  links: {
    official: { href: "https://tech.cornell.edu/research/makerlab/", label: "The MakerLAB on tech.cornell.edu" },
    more: [
      {
        href: "https://www.youtube.com/playlist?list=PL4EfVJKkC-nrCuEUS1wmk0L6jhteO2Do6",
        label: "How-to videos on YouTube",
      },
      { href: "https://www.instagram.com/cornelltechmakerlab/", label: "@cornelltechmakerlab on Instagram" },
    ],
  },

  photos: [
    {
      src: "/lab/makerlab-printers.webp",
      width: 640,
      height: 480,
      alt: {
        en: "3D printers lined up in front of the red MakerLAB wall.",
        ar: "طابعات ثلاثية الأبعاد مصطفة أمام جدار MakerLAB الأحمر.",
        es: "Impresoras 3D alineadas frente a la pared roja del MakerLAB.",
        fr: "Imprimantes 3D alignées devant le mur rouge du MakerLAB.",
        he: "מדפסות תלת־ממד בשורה מול הקיר האדום של MakerLAB.",
        hi: "MakerLAB की लाल दीवार के सामने कतार में लगे 3D प्रिंटर।",
        ja: "MakerLAB の赤い壁の前に並ぶ 3D プリンター。",
        ko: "MakerLAB의 빨간 벽 앞에 늘어선 3D 프린터.",
        "pt-BR": "Impressoras 3D alinhadas em frente à parede vermelha do MakerLAB.",
        ru: "3D-принтеры в ряд перед красной стеной MakerLAB.",
        tr: "MakerLAB'in kırmızı duvarının önünde sıralanmış 3D yazıcılar.",
        "zh-CN": "排列在 MakerLAB 红色墙壁前的 3D 打印机。",
      },
      caption: {
        en: "3D printers in front of the MakerLAB wall",
        ar: "طابعات ثلاثية الأبعاد أمام جدار MakerLAB",
        es: "Impresoras 3D frente a la pared del MakerLAB",
        fr: "Imprimantes 3D devant le mur du MakerLAB",
        he: "מדפסות תלת־ממד מול הקיר של MakerLAB",
        hi: "MakerLAB की दीवार के सामने 3D प्रिंटर",
        ja: "MakerLAB の壁の前の 3D プリンター",
        ko: "MakerLAB 벽 앞의 3D 프린터",
        "pt-BR": "Impressoras 3D em frente à parede do MakerLAB",
        ru: "3D-принтеры перед стеной MakerLAB",
        tr: "MakerLAB duvarının önünde 3D yazıcılar",
        "zh-CN": "MakerLAB 墙前的 3D 打印机",
      },
    },
    {
      src: "/lab/makerlab-floor.webp",
      width: 640,
      height: 480,
      alt: {
        en: "The open MakerLAB floor, with orange chairs and workbenches.",
        ar: "المساحة المفتوحة في MakerLAB مع كراسٍ برتقالية وطاولات عمل.",
        es: "El espacio abierto del MakerLAB, con sillas naranjas y mesas de trabajo.",
        fr: "L'espace ouvert du MakerLAB, avec des chaises orange et des établis.",
        he: "החלל הפתוח של MakerLAB, עם כיסאות כתומים ושולחנות עבודה.",
        hi: "MakerLAB का खुला फ़्लोर, नारंगी कुर्सियों और वर्कबेंच के साथ।",
        ja: "オレンジ色の椅子とワークベンチが並ぶ、MakerLAB のオープンなフロア。",
        ko: "주황색 의자와 작업대가 있는 MakerLAB의 탁 트인 공간.",
        "pt-BR": "O espaço aberto do MakerLAB, com cadeiras laranja e bancadas de trabalho.",
        ru: "Открытое пространство MakerLAB: оранжевые стулья и верстаки.",
        tr: "MakerLAB'in açık alanı: turuncu sandalyeler ve çalışma tezgâhları.",
        "zh-CN": "MakerLAB 的开放空间，有橙色椅子和工作台。",
      },
      caption: {
        en: "The open lab floor",
        ar: "المساحة المفتوحة في المختبر",
        es: "El espacio abierto del laboratorio",
        fr: "L'espace ouvert du laboratoire",
        he: "החלל הפתוח של המעבדה",
        hi: "लैब का खुला फ़्लोर",
        ja: "ラボのオープンなフロア",
        ko: "탁 트인 랩 공간",
        "pt-BR": "O espaço aberto do laboratório",
        ru: "Открытое пространство лаборатории",
        tr: "Laboratuvarın açık alanı",
        "zh-CN": "开放的实验室空间",
      },
    },
  ],

  // The About page's words about the lab (identity spec §6). Sources: the
  // pages in `links`, and the comment in src/lib/ai/lab-context.ts.
  about: {
    title: "The MakerLAB at Cornell Tech",
    lede: "A place where anyone at Cornell Tech can take an idea from a first sketch to a working prototype.",
    body: [
      "The MakerLAB is Cornell Tech's makerspace: an accessible production hub with the tools to prototype and build. Students get hands-on experience solving real problems, startups refine their products, and faculty build prototypes for their research. It has a wood shop for large builds and assembly, a laser room for cutting and engraving, and an electronics lab.",
      "The lab started in 2016 with two machines, a laser cutter and a 3D printer, and grew from there. Its new home on the first floor of the Tata Innovation Center opened on May 2, 2025.",
    ],
    where: "First floor, Tata Innovation Center, Cornell Tech, 2 West Loop Road, Roosevelt Island, New York, NY 10044",
    hours:
      "Access holders: 8 AM to 8 PM, seven days a week. Super Makers, who apply for it, have access around the clock.",
    hoursNote: "Hours and access can change: the official MakerLAB page has the current ones and how to apply.",
    community:
      "Through CRAFT@Large, the MakerLAB's community initiative, organizations across New York City can propose projects that need digital fabrication and make them with the lab.",
    thanks:
      "Thanks to Miguel Ramirez Peraza, who interned with the MakerLAB in 2025 and 2026, for building the first inventory search that sparked the idea.",
  },

  assistant: {
    // The facts in the assistant's "Where you are" block, after "You are
    // <assistant>, the AI inside <site>, the website for the <lab> at
    // <institution>." Static per deploy: every chat turn pays for it, so keep
    // it short, and state only what has a public source or the lab supplied.
    //
    // Sources (read 2026-09-28):
    // - MakerLAB page — mission ("from initial sketch to refined prototype"),
    //   address, contacts, access tiers and hours, CRAFT@Large:
    //   https://tech.cornell.edu/research/makerlab/
    // - Opening of the new MakerLAB, first floor of the Tata Innovation Center,
    //   May 2, 2025; "accessible production hub"; who uses it:
    //   https://news.cornell.edu/stories/2025/05/cornell-tech-celebrates-opening-new-makerlab-tata-innovation-center
    // - Wood shop, laser room, electronics lab; eligible users:
    //   https://tech.cornell.edu/news/cornell-tech-makerlab
    // - Started in 2016 with a laser cutter and an FDM 3D printer (search snippet;
    //   the page answered 403):
    //   https://www.tradelineinc.com/reports/2023-10/how-cornell-tech-built-inclusive-maker-space-new-york-city
    // - Niti Parikh, Director, Learning Spaces and MakerLABs:
    //   https://tech.cornell.edu/people/niti-parikh/
    // - Cornell Tech: https://tech.cornell.edu/about/ and
    //   https://en.wikipedia.org/wiki/Cornell_Tech (Roosevelt Island campus opened
    //   2017; Dean Greg Morrisett; Studio; Jacobs Technion-Cornell Institute)
    // - Cornell University: https://www.cornell.edu/about/
    //
    // Owner-supplied, no public source: that the lab is just inside Tata's main
    // entrance, immediately on the left (Isaac, 2026-09-28); Luis Rodrigo Navarro's title "Assistant Director" (the public page
    // says "Luis Navarro, MakerLAB Manager"); MakerLAB Tools, the Assistant, Isaac
    // Steinberg's role, and the operate / debug / create framing.
    //
    // Left out as unconfirmed: the lab's floor area, a room name, where it was
    // before 2025, how to become a Super Maker beyond "apply", and any other
    // access rule. The assistant is told to send those questions to staff.
    aboutLab: `Isaac Steinberg built MakerLAB Tools as its Tech Lead.

**The MakerLAB** is Cornell Tech's makerspace: easy access to prototyping tools so students, faculty and the campus community can take an idea "from initial sketch to refined prototype". It is on the **first floor of the Tata Innovation Center**, just inside the main entrance: walk in and it is immediately on your left (Cornell Tech, 2 West Loop Road, Roosevelt Island, New York, NY 10044). It has a wood shop, a laser room and an electronics lab; the catalog below is the real inventory. It started in 2016 with a laser cutter and a 3D printer, and its current space opened on May 2, 2025. It is run by **Niti Parikh**, Director, Learning Spaces and MakerLABs (ntp27@cornell.edu), with **Luis Rodrigo Navarro**, Assistant Director (ln328@cornell.edu). The official page (https://tech.cornell.edu/research/makerlab/) lists hours of 8 AM to 8 PM daily for Access Holders and 24/7 for Super Makers, who apply for it. Its community initiative, CRAFT@Large, takes on digital-fabrication projects with organizations across New York City.

**Cornell Tech** is Cornell University's graduate campus in New York City, on Roosevelt Island since 2017, combining research, graduate programs and startups; every master's student takes Studio, and many prototype in the MakerLAB. **Cornell University** was founded in 1865 in Ithaca, NY.`,
    // Whom the assistant suggests asking for a first use or hands-on help.
    helperTitle: "SuperMaker",
  },

  pages: {
    // `/product` describes the software with this site's screenshots.
    product: true,
  },

  // True: `lab/floor-plan.json` is this lab's map (signed-in people only).
  // False: no /map page, no "Where is it?" thumbnail, the assistant says the
  // lab has no map.
  map: true,
});
