import type { privacy as dePrivacy } from "../de/privacy";

/** F7 · Texte für Datenschutz-Seite (PrivacyPage), englisch. Eigener Chunk – lädt erst mit der Seite. */
export const privacy = {
  title: "Privacy and your data",
  /** V2 Etappe 3o: Kopf als Karte – Kennzeile, Kurzfassung als Pillen (stehen so auch unten im Text). */
  label: "In plain words",
  facts: ["No tracking", "No ads", "Location off"],
  jumpLabel: "Jump to",
  disclaimer: "This page describes in plain words how the app handles data. It doesn't replace a legally reviewed privacy policy – the operator must add one before the public launch.",
  sections: [
    {
      title: "What is stored",
      items: [
        "Account: your email address and an encrypted password (with Supabase Auth).",
        "Profile: display name, optionally a profile picture, city and interests.",
        "Birthday (only if you add it): day and month, no year. Members of your crews can see it and get one reminder a week before; remove it and it's gone straight away.",
        "“Let's go there sometime” (only if you save a place): which place, for which crew, when and by whom. Members of that crew can see it; the list belongs to the crew – if you delete your account, the place stays without your name.",
        "“Away” (only if you add something): the start and end of a period, no reason and no place. Members of your crews can see it until it's over; after that the app deletes it the next time you add one.",
        "Activity: crews, messages in the crew chat, polls, votes, plans, replies, booking notes, rides, points and notifications.",
        "Settings: budget, distance, notifications and your choice on location sharing.",
        "Photos for a plan (only if you share some): the shrunk photo – without location, camera and time, which the app removes first – and who shared it when. Only the plan's crew can see it. You can delete your photos at any time. If you delete your account, or the plan or crew is deleted, the app deletes the files too; at the latest 12 months after the night out, the photos disappear by themselves. If you report a photo, we store the reason; the organiser and crew admins see it without your name.",
        "Push notifications (only if you turn them on): per device, the address at your browser's push service, two public keys for encryption and a device name like “Chrome on Android”.",
      ],
    },
    {
      title: "Who sees what",
      items: [
        "Your profile is only visible to people you share at least one crew with.",
        "A crew's content is only visible to its members. The database itself enforces this, not just the interface.",
        "Only you can see your settings, your email address and your points.",
        "Calendar subscription: if you create a subscription link, any calendar app (and any person) that knows it can read your plans – without logging in. You can replace or end it at any time.",
        "Nothing can be accessed without logging in – except what you deliberately share via link: invites, shared plans and polls, your calendar subscription.",
      ],
    },
    {
      title: "Location",
      items: [
        "Location sharing is off by default.",
        "Device location only when you tap, around a plan (“Where are you?” on the plan page, from 2 hours before the start): only the latest position is stored, rounded to about 10 m, with no history. Only crew members who said they're in or “maybe” for that plan can see it. It's deleted as soon as you stop, after 3 hours at most, at the latest when the plan ends, if it's cancelled and with your account.",
        "Distances are estimated from the city in your profile (straight line from the city centre).",
        "Maps only load when you tap “Load map” – then a request goes to OpenStreetMap.",
        "The map in Discover first shows places only as dots. It only loads the OpenStreetMap street map after “Load street map” (applies to this device; “Street map off” undoes it).",
      ],
    },
    {
      title: "Your rights",
      items: [
        "Access: in Settings you can download all your data as a file.",
        "Rectification: you can change your profile and settings at any time.",
        "Erasure: in Settings you can delete your account immediately and permanently.",
      ],
    },
    {
      title: "Third parties",
      items: [
        "Fonts and icons are part of the app itself; nothing is loaded from font or tracking services.",
        "Photos of places only load when you tap “Show photo” or turn on “Always load photos of places” (applies only on this device). Then requests without cookies go to Wikimedia Commons and Wikidata – Wikimedia learns your IP address and which photo is being loaded.",
        "Push notifications only exist if you turn them on for a device. Then every notification goes through your browser's push service (Google, Apple, Mozilla or Microsoft) – end-to-end encrypted; the service only sees that something is going to your device. Turning them off or logging out unregisters the device.",
        "There are no ads and no tracking.",
        "Data is stored with Supabase (database and login) in the region the operator chooses.",
      ],
    },
  ],
  toSettings: "Go to Settings",
  toLogin: "Go to login",
} satisfies typeof dePrivacy;
