# WhatsApp Business: welcome reply and template drafts

Number: +91 98739 45238 (the one every wa.me link on the site uses).

**Rules we keep**
- A person who messages us first opens a 24-hour window. Inside it we can reply freely; the welcome reply below is a normal message, not a template.
- Outside the window, only an approved template can be sent. **Utility** templates are for something the person asked for (their setup, their join). **Marketing** templates (offers, news, festival wishes) need the person's clear opt-in to marketing messages first, recorded with the date. The two are never mixed in one template.
- Every message says how to stop: reply STOP. A STOP is honoured the same day and recorded.
- Read the source code in the first message (for example `(LI1)` or `(FB2)`) and note it against the chat label, so each channel's chats can be counted.

---

## Welcome auto-reply (greeting message, sent when someone messages us)

> Namaste, and thank you for writing to Parwah! 🙏
>
> Parwah is a free family app: a daily "I am okay" check-in, shared to-dos, doctors, medicines and papers, and an SOS that reaches the whole family. Parents stay in charge.
>
> Start here, in your phone's browser: https://parwah-hq.anchit-tandon.com
> Then tap "Add to Home Screen" to keep it like an app. Steps for your phone: https://parwah-hq.anchit-tandon.com/get/
>
> Reply with:
> 1. Help me set up my family
> 2. A question
> 3. Tell me when the care range opens
>
> Anchit, the founder, reads these himself, usually within a day. Reply STOP any time and we will not message you again.

**Away message (outside 9am to 9pm IST):** "Thank you for writing to Parwah. We reply between 9am and 9pm IST. While you wait, you can start your family here: https://parwah-hq.anchit-tandon.com"

**Opt-in question (only after we have helped them, never in the first reply):**

> One more thing: may we send you an occasional message about new Parwah features and festival tips? About two a month, never forwards. Reply YES to say yes. You can say STOP any time.

---

## Template 1: setup help follow-up

- **Name:** `setup_follow_up`
- **Category:** UTILITY
- **Language:** en
- **When:** the day after someone asked for help setting up, if they have not replied.
- **Body:**

> Hi {{1}}, this is Parwah. Yesterday you asked for help setting up your family. Here are the steps for your phone: {{2}}. Reply here with any question and we will help. Reply STOP to stop these messages.

- **Example values:** {{1}} = Priya, {{2}} = https://parwah-hq.anchit-tandon.com/get/
- **Button (quick reply):** "I am stuck" 

## Template 2: launch list confirmation

- **Name:** `launch_list_joined`
- **Category:** UTILITY
- **Language:** en
- **When:** right after someone joins the launch list on the website and gave a phone number.
- **Body:**

> Hi {{1}}, you are on the Parwah launch list for {{2}}. We will message you once, when it opens. To be taken off the list, reply STOP or write to anchit.tandon@gmail.com.

- **Example values:** {{1}} = Rahul, {{2}} = the care range

## Template 3: family invite reminder

- **Name:** `family_invite_reminder`
- **Category:** UTILITY
- **Language:** en
- **When:** the person asked us to remind them to invite a family member (for example "remind me on Sunday to add Papa").
- **Body:**

> Hi {{1}}, here is the reminder you asked for: invite {{2}} to your family on Parwah. Open Parwah, tap Family, then Invite family. Reply STOP to stop these reminders.

- **Example values:** {{1}} = Neha, {{2}} = Papa

---

## Marketing template draft (needs opt-in first)

- **Name:** `festival_tip`
- **Category:** MARKETING
- **Send only to:** people who replied YES to the opt-in question.
- **Body:**

> Hi {{1}}, a small {{2}} idea from Parwah: {{3}}. Reply STOP to stop these messages.

- **Example values:** {{1}} = Arjun, {{2}} = Lohri, {{3}} = set up the family video call before the bonfire so the cousins abroad can join
