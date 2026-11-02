// EK SAWAAL: the questions a family's storytellers are asked, one a week,
// and the throwback questions a group gets. Copy a person reads, so it
// passes the same scan as the site (site/tests/test_site.py): grade-6
// words, about half in Hinglish, warm and about living, never morbid. No
// "before it's too late", no illness, no endings. Imports nothing, so the
// gate reads it before npm install.

export const STORY_SEED = [
  'What is your earliest memory?',
  'What games did you play as a child?',
  'Who was your best friend at school, and what did you do together?',
  'What was your school like? How did you get there each day?',
  'Which teacher do you still remember, and why?',
  'What was your first job? How much did it pay?',
  'What did you buy with your first salary?',
  'How did you meet your husband or wife?',
  'What do you remember about your wedding day?',
  'Which festival did you love most as a child, and how was it celebrated?',
  'What was your favourite song when you were young?',
  'Which film did you see again and again?',
  'What is a lesson life taught you that you want us to know?',
  'Which place do you miss the most?',
  'What was the house you grew up in like?',
  'What did a normal Sunday look like when you were young?',
  'What was the best trip you ever took?',
  'What made you laugh the most as a child?',
  'What were your parents like?',
  'What were you proud of when you were twenty?',
  'What did your town look like when you were young?',
  'What was the first thing you cooked by yourself?',
  'What is the best advice anyone ever gave you?',
  'Tell us about a day you will never forget.',
  'What was your favourite sweet as a child, and who made it?',
  'What did you want to be when you grew up?',
  'Aap dono pehli baar kaise mile the?',
  'Bachpan mein aapka sabse pakka dost kaun tha?',
  'School mein aapki sabse yaadgaar shararat kya thi?',
  'Pehli naukri ka pehla din kaisa tha?',
  'Shaadi ke din ki sabse mazedaar baat kya thi?',
  'Bachpan ki Diwali kaise manate the?',
  'Holi pe aapke mohalle mein kya hota tha?',
  'Aapka sabse pasandeeda gaana kaunsa hai, aur kyun?',
  'Radio pe aap kya sunte the?',
  'Nani ya Dadi ke ghar ki koi yaad sunaiye.',
  'Aapke gaon ya shehar ki kaunsi jagah sabse zyada yaad aati hai?',
  'Bachpan mein garmi ki chhuttiyan kaise bitate the?',
  'Aapke papa ne kya sikhaya jo aaj bhi kaam aata hai?',
  'Aapki mummy ka banaya kaunsa khana sabse achha lagta tha?',
  'Pehli cycle ya scooter kab li thi?',
  'College ke din kaise the?',
  'Pehli baar train mein safar kab kiya tha?',
  'Ghar mein pehla TV ya phone kab aaya tha?',
  'Aapki zindagi ka sabse khushi wala din kaunsa tha?',
  'Kaunsi purani cheez aaj bhi sambhal ke rakhi hai, aur kyun?',
  'Bachpan mein kaunsa khel sabse zyada khelte the?',
  'Jawani mein aap kya banna chahte the?',
  'Kisi dost ki koi baat jo aaj bhi hasa deti hai?',
  'Aapke zamane mein shaadi kaise hoti thi?',
  'Hamare liye aapki ek seekh kya hai?',
  'Pehli salary se kya kharida tha?'
];

// A group's weekly throwback: one question to everyone, answers side by side.
export const THROWBACK_SEED = [
  'Who was the strictest teacher in 10th?',
  'Which canteen snack did we always fight over?',
  'What was the funniest thing on a school trip?',
  'Which song was always playing in the hostel?',
  'Who was always late for class?',
  'Best bunk ever: where did we go?',
  'Which exam did we all study for the night before?',
  'Who had the best handwriting in class?',
  'Which cricket match did we watch together?',
  'What did we eat after every exam?',
  'Kaunsi movie hum sab ne saath dekhi thi?',
  'Hostel mess ka sabse bura khana kya tha?',
  'Farewell pe kisne kya pehna tha?',
  'Sabse yaadgaar birthday party kiski thi?',
  'Annual day pe kisne kya kiya tha?',
  'Kaunsi chai ki tapri hamara adda thi?',
  'Sabse lambi trip kaunsi thi, aur kaun so gaya tha?',
  'Pehla mobile phone group mein kiske paas aaya tha?',
  'Kaunsa teacher sabse achha padhata tha?',
  'Exam ke baad hum kahan jaate the?'
];

// What the recipe screen says. Recipes are for food: the dish, who made it,
// and how. The gate scans these lines too.
export const RECIPE_COPY = {
  intro: 'The dishes your family loves, in the words of the person who made them.',
  formNote: 'Recipes here are for food: the dish, who made it, and how to make it.',
  memoryHint: 'e.g. Mummy made this every Sunday',
  groupIntro: 'The group cookbook: the dishes from hostel nights and college trips.'
};
