# Meta ads (Facebook and Instagram): three angles

**Objective:** Engagement, conversion location **Messaging apps (WhatsApp)**. Button: **Send WhatsApp message**.
**Pre-filled message** (set in the ad's message template so every chat says which ad it came from):
- Angle 1: `Hi Parwah (FB1) - I want to set up Parwah for my family.`
- Angle 2: `Hi Parwah (FB2) - I want to share the care with my sibling.`
- Angle 3: `Hi Parwah (FB3) - I want to set up my parents before I fly back.`

If an ad sends people to the website instead, use the links in `marketing/README.md` (they carry the same codes, and the site's WhatsApp buttons pick them up).

**Creatives:** each angle has three sizes in this folder:
`<angle>-1080x1080.png` (feed), `<angle>-1080x1350.png` (feed, tall), `<angle>-1080x1920.png` (Stories and Reels; the top 250px and bottom 300px are kept clear).
Alt text for every image is in `marketing/alt.json`.

**Every claim below is true of the live app today.** Do not add features from the "coming this month" list to an ad until they are live.

---

## Angle 1: the 11pm call (peace of mind)

Creatives: `angle1-11pm-call-*.png` (Papa's big-button screen)

**Primary text**

- **English:** Every night the call ends the same way: "Sab theek hai, beta." Parwah gives your family one place for the rest of it. Papa taps All is well, the whole family sees it. Doctors, medicines, papers and the emergency card are shared. Parents stay in charge. Free for families.
- **Hinglish:** Roz raat ka call, aur wahi jawab: "Sab theek hai, beta." Parwah pe Papa ek tap karte hain, All is well, aur poori family ko pata chal jaata hai. Doctor, dawai ki list, papers, emergency card, sab ek jagah. Free for families.
- **Hindi:** हर रात फ़ोन पर वही जवाब: "सब ठीक है, बेटा।" परवाह पर पापा एक बटन दबाते हैं, और पूरे परिवार को पता चल जाता है। डॉक्टर, दवाइयों की सूची, ज़रूरी कागज़ और इमरजेंसी कार्ड, सब एक जगह। परिवारों के लिए मुफ़्त।

**Headlines** (40 characters max)

1. One tap from Papa. Calm for all.
2. Sab theek hai? Now you know.
3. Free family app, made in India

**Descriptions**

1. Daily check-in, shared to-dos, one family book.
2. Parents in charge. Free for families.

---

## Angle 2: siblings share the care

Creatives: `angle2-siblings-*.png` (the shared to-do list)

**Primary text**

- **English:** In every family, one sibling remembers everything: the doctor, the bill, the check-up date. Parwah makes it a shared list. Invite your brother or sister, and every task shows who has it. No more "did you do it?" on the family group. Free for families.
- **Hinglish:** Har family mein ek bhai ya behen ko sab yaad rehta hai: doctor, bill, check-up ki date. Parwah pe yeh sab ek shared list ban jaata hai. Sibling ko invite karo, aur har kaam pe dikhta hai kisne liya. Free for families.
- **Hindi:** हर परिवार में एक भाई या बहन को सब याद रहता है: डॉक्टर, बिल, चेक-अप की तारीख़। परवाह पर यह सब एक साझा सूची बन जाता है। अपने भाई या बहन को जोड़िए, और हर काम पर दिखता है कि किसने लिया। परिवारों के लिए मुफ़्त।

**Headlines**

1. Stop being the only one who remembers
2. Share Mummy-Papa's to-dos, together
3. Invite your sibling. It's free.

**Descriptions**

1. Shared to-dos, doctors and bills in one app.
2. See who has what. Free for families.

---

## Angle 3: NRI, "set it up while you're home"

Creatives: `angle3-nri-home-visit-*.png` (the family's Today screen)
Run from **1 Dec 2026 to 10 Jan 2027** only.

**Primary text**

- **English:** Flying home this December? Spend one evening setting up Parwah with Mummy-Papa. Give them the big-button screen, add the family doctor and medicines, snap the insurance papers into the vault, make the first video call. Then fly back with the whole family on the same page. Free.
- **Hinglish:** December mein ghar ja rahe ho? Ek shaam Mummy-Papa ke saath Parwah set up karo. Unke phone pe bade buttons, doctor aur dawai ki list, insurance papers vault mein, aur pehli video call. Phir wapas jaao, poori family ek page pe. Free.
- **Hindi:** दिसंबर में घर जा रहे हैं? एक शाम मम्मी-पापा के साथ परवाह सेट कीजिए। उनके फ़ोन पर बड़े बटन, डॉक्टर और दवाइयों की सूची, बीमा के कागज़ वॉल्ट में, और पहली वीडियो कॉल। फिर लौटिए, पूरा परिवार एक साथ। मुफ़्त।

**Headlines**

1. Set Mummy-Papa up before you fly back
2. One evening at home. All year together.
3. Free family app for Indians abroad

**Descriptions**

1. Check-ins, doctors, papers and video calls.
2. Parents in charge. Free for families.

---

## Targeting notes

**No health targeting, ever.** Do not use any interest, behaviour or custom audience built on a health condition, medicine, hospital, pharmacy or insurance claim. Meta restricts it, and it is not who we are. We target the adult child by age, place and broad life interests only.

**Ad set A: India metros (angles 1 and 2)**
- Location: people living in Delhi NCR, Mumbai, Bengaluru, Pune, Hyderabad, Chennai, Kolkata, Ahmedabad.
- Age 28 to 45, all genders.
- Interests (broad, pick 3 to 5): Parenting, Family, Indian festivals, Online banking, WhatsApp, Travel. Advantage+ audience on, with these as suggestions.
- Languages: English, Hindi.
- Placements: Facebook and Instagram feeds, Stories, Reels.

**Ad set B: Indians abroad (angle 3, Dec to Jan; angle 1 the rest of the year)**
- Location: people living in UAE, United States, United Kingdom, Canada.
- Age 28 to 45. Language: Hindi or English.
- Interests: Expatriate (Indian), Indian cinema, Cricket, Air India, Visiting family. Use "People living in this location", not "recently in", so people visiting home in December are reached by ad set A.
- Time zone: schedule by the viewer's time zone.

**Ad set C: Bhai Dooj (angle 2), 7 to 10 Nov only.** Same as A.

**The care range (/care/) is a separate business.** Keep it in its own campaign with its own Meta dataset (pixel or Conversions API dataset) and its own custom conversions, so the app's numbers and the range's numbers never mix. Today the site loads no Meta pixel; if one is ever added, it goes on the marketing pages only, after the visitor says yes, and never inside the app.

**Measure:** WhatsApp chats started per ad (the code in the first message: FB1, FB2, FB3), then how many of those families set up Parwah. Cost per chat is the number to watch in week one.

**Comply:** No before/after and no fear. <!-- never-say -->Never "track your parents" or "monitor".<!-- /never-say --> Parents in creatives are shown as capable people, never as frail. SOS is never presented as an emergency service.
