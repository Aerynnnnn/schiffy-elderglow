// Vibe pass 2, lane B: pup personalities. Pure (no DOM, no Math.random), loaded right after sim.js.
// Every pup has ONE trait (sleepy, brave, foodie, poet, curious, cuddly, bouncy, tidy). It is NOT stored in the save:
// Traits.of(S, i) derives it from data that never changes for a pup:
//   - the six start pups: a fixed trait each (so every island's Pudding is a foodie);
//   - a puppy: half the time a parent's trait (hash), else like any newcomer;
//   - everyone else: hash(island event seed, pup id), nudged toward the traits the island has fewest of (so an island
//     gets a mix), in list order (the pup list only grows, indices + ids are stable; a rename changes nothing).
// So an existing island gains traits with no save change, offline == online, and a visit (Sim.sanitize'd snapshot) is
// stable too. Sim nudges (small, balance-safe; sim_check "pup traits" cases): night nap chance (NAP), a newcomer's liked
// job leans toward its trait (LIKE_P). Everything else a trait does is words (diary lines, chatter) and what the pup
// does while it rests (src/pup_life.js).
(function () {
  'use strict';
  const K = ['sleepy', 'brave', 'foodie', 'poet', 'curious', 'cuddly', 'bouncy', 'tidy'];
  const START = { pudding: 'foodie', bean: 'brave', mochi: 'cuddly', biscuit: 'bouncy', waffles: 'poet', pepper: 'sleepy' };
  const INFO = {
    sleepy: { name: 'Sleepy', what: 'naps a little more at night and talks in its sleep' },
    brave: { name: 'Brave', what: 'first over every bridge, last to bed' },
    foodie: { name: 'Foodie', what: 'always knows where the berries are' },
    poet: { name: 'Poet', what: 'notices small lovely things and writes them down' },
    curious: { name: 'Curious', what: 'sniffs everything, chases every moth' },
    cuddly: { name: 'Cuddly', what: 'naps in heaps and never alone' },
    bouncy: { name: 'Bouncy', what: 'never walks when it can hop' },
    tidy: { name: 'Tidy', what: 'likes things just so, stacks pebbles for fun' },
  };
  // sim nudges: night nap chance multiplier (Sim.napNow) and the jobs a newcomer of this trait tends to love
  const NAP = { sleepy: 1.3, brave: 0.85 };
  const FAV = { sleepy: ['rest', 'nourish'], brave: ['protect', 'light'], foodie: ['food', 'nourish'], poet: ['spirit', 'light'], curious: ['stone', 'water'],
    cuddly: ['nourish', 'water'], bouncy: ['water', 'spirit'], tidy: ['build', 'wood'] };
  const C = { LIKE_P: 0.4 };
  const hash = n => { n = (n ^ 61) ^ (n >>> 16); n = Math.imul(n, 9); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); return (n ^ (n >>> 15)) >>> 0; };
  const hstr = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const memo = new WeakMap();   // pup object -> trait (never serialised)

  // the trait a pup with this id at list index i gets (earlier pups must already be in s.pups)
  function pick(s, id, i, parents) {
    if (i < 6 && START[id]) return START[id];
    const seed = s.events && s.events.seed ? s.events.seed >>> 0 : 0, h = hash((seed * 31) ^ hstr(String(id)) ^ (i * 7919));
    if (parents && parents.length === 2 && (h >>> 3) % 2 === 0) { const q = s.pups[parents[(h >>> 5) % 2]]; if (q) return of(s, parents[(h >>> 5) % 2]); }
    const n = {}; for (const k of K) n[k] = 0;
    for (let j = 0; j < Math.min(i, s.pups.length); j++) n[of(s, j)]++;
    let t = K[h % K.length]; const lo = Math.min(...K.map(k => n[k]));
    if (n[t] > lo + 1) { const L = K.filter(k => n[k] === lo); t = L[(h >>> 9) % L.length]; }
    return t;
  }
  function of(s, i) {
    const p = s && s.pups && s.pups[i]; if (!p) return 'curious';
    let t = memo.get(p); if (t) return t;
    t = pick(s, p.id, i, p.parents); memo.set(p, t); return t;
  }
  const napK = (s, i) => NAP[of(s, i)] || 1;
  // a newcomer's liked job: LIKE_P of the time one of its trait's favourites (h = the arrival hash), else the old roll
  function like(trait, h, roll) { const F = FAV[trait]; return F && (h >>> 17) % 1000 < C.LIKE_P * 1000 ? F[(h >>> 11) % F.length] : roll; }

  // ---------------------------------------------------------------- words (diary lines + chatter), a pup's own voice
  // {n} = trips, {f} = a friend's name, {d} = a sky isle, {a} = an area, {b} = a building, {j} = a job word
  const JOBW = { water: 'water', light: 'the orbs', nourish: 'the garden', protect: 'guard duty', spirit: 'music', wood: 'wood', stone: 'stones', food: 'berries', build: 'building', rest: 'a rest' };
  const DIARY = {
    sleepy: {
      arr0: 'Woke up under a big grey tree. It yawned. I yawned back. We understand each other.',
      arr: ['Crossed a very long bridge. Found a bed at the end of it. Best day.', 'Arrived. Had a nap to celebrate arriving.'],
      job: { water: 'Carried water {n} times. The river sounds like a lullaby up close.', light: 'Lit the orbs {n} times. They glow like night lights. Very helpful for napping.',
        nourish: 'Tucked compost round the roots. Then tucked myself in next to it.', protect: 'Kept watch by the roots. Kept one eye open. Mostly.',
        spirit: 'Played a slow song. Everyone swayed. Two pups fell asleep. A success.', wood: 'Stacked {n} loads of wood. The woodpile is a good pillow.',
        stone: 'Rolled {n} stones home. Stones are very restful. They never hurry.', food: '{n} baskets of berries. Napped in the bushes between baskets.',
        build: 'Built things. Hammering is loud. I am proud and also tired.', rest: 'Napped in the sun. Then in the shade. Then in the sun again. A full day.' },
      wave: ['{a} turned colourful. I watched it from a very comfy spot.', 'Woke from a nap and {l} had colour in it. Best nap ever.'], fr3: '{f} is my closest friend. We nap back to back, and they never snore. Much.', fr: '{f} lets me lean on them when I doze off. That is friendship.',
      go: 'Flew to {d}. Slept most of the way. The clouds were soft.', back: 'Home from {d}. My own bed missed me.', blt: 'Helped build {b}. Already found the best nap corner in it.',
      pup: '{f} was born today. Tiny. Sleeps even more than me. I am so proud.',
    },
    brave: {
      arr0: 'Woke up under a big grey tree. Something was wrong with the colours. I decided to fix it.',
      arr: ['Crossed the long bridge without looking back. This island needs paws. Mine are ready.', 'Arrived. Saluted the tree. The tree rustled. I am taking that as a salute.'],
      job: { water: '{n} buckets, no spills. Okay, one spill. A brave one.', light: 'Carried light into the dark {n} times. The dark backed off. Every time.',
        nourish: 'Dug deep for the roots today. Found a worm. We came to an agreement.', protect: 'Stood guard by the roots all day. Nothing sneaky got past me. Nothing.',
        spirit: 'Played the drums LOUD. The tree hummed along. Brave music.', wood: '{n} loads of logs. My arms are mighty now.',
        stone: 'Moved {n} boulders. One of them moved me first. Then I won.', food: 'Picked {n} baskets of berries. Faced a very prickly bush. Did not flinch.',
        build: 'Climbed the scaffolding first. Waved from the top. Somebody cheered.', rest: 'Rested, but bravely. Ready for anything.' },
      wave: ['{a} turned colourful today! I ran right into it before anyone else.', 'The grey ran away from {l} today. I chased it a bit further, to be sure.'], fr3: '{f} is my closest friend. I would cross any bridge for them. Twice.', fr: '{f} and I watch each other\'s backs now. Partners.',
      go: 'Off to {d}! Sat at the very front of the boat.', back: 'Back from {d}. I looked down the whole way. On purpose.', blt: 'Helped build {b}. I carried the biggest beam.',
      pup: '{f} was born today. I will keep them safe. Always.',
    },
    foodie: {
      arr0: 'Woke up under a big grey tree. Sniffed around. Somewhere on this island there are berries. I can tell.',
      arr: ['Crossed a long bridge, following a smell. It was berries. Found a bed too!', 'Arrived today. First question: where do we keep the snacks?'],
      job: { water: 'Carried {n} buckets. Water is just soup for trees, if you think about it.', light: 'Lit the orbs {n} times. They look like big honey drops. Did not lick one.',
        nourish: 'Fed the roots today. Compost smells like a very old picnic. The tree loved it.', protect: 'Kept watch by the roots. Packed a snack. Shared it with a beetle.',
        spirit: 'Played music for the island. Wrote a song about pie. It is called Pie.', wood: '{n} loads of logs. Thinking about toast the whole time.',
        stone: 'Hauled {n} stones. One looked exactly like a bun. Very disappointing.', food: '{n} baskets of berries. Ate a few. Okay, more than a few. Purple paws again.',
        build: 'Building day. Hungry work. Very, very hungry work.', rest: 'A lazy day. Dreamt of honey. Woke up chewing my ear.' },
      wave: ['{a} turned colourful! Everything looks like candy now.', 'Colour came back to {l}. The grass smells like mint now. I checked. Twice.'], fr3: '{f} is my closest friend. They save me the crunchy end of everything.', fr: '{f} and I share every snack now. Even the last berry. That is love.',
      go: 'Off to {d}! Packed berries. Ate the berries. Packed more berries.', back: 'Back from {d}. Sky air makes you hungry. Ate two dinners.', blt: 'Helped build {b}. Asked if it would have a kitchen. Still waiting.',
      pup: '{f} was born today! Tiny paws, very big appetite. Takes after me.',
    },
    poet: {
      arr0: 'Woke beneath a great grey tree. Its leaves sounded like pages turning. I think it has a story to tell.',
      arr: ['Crossed a long bridge at dusk. The island was quiet, like a held breath. I will stay.', 'Arrived. The tree waved. Maybe the wind. Maybe not. I prefer maybe not.'],
      job: { water: '{n} buckets. Each one held a little piece of sky.', light: 'Lit the orbs {n} times. Light is just warmth you can see.',
        nourish: 'Knelt by the roots and listened. The tree drinks slowly, like someone thinking.', protect: 'Watched the roots till dusk. Shadows are only light that got lost.',
        spirit: 'Wrote a song with no words. The tree knew them anyway.', wood: 'Carried {n} logs. Each ring a year. I said thank you to every one.',
        stone: '{n} stones today. Old stones are very patient poets.', food: 'Picked berries in the morning mist. {n} baskets of tiny sunsets.',
        build: 'Helped build today. A house is a promise someone keeps with their paws.', rest: 'Watched the clouds change their minds all day. I did not mind.' },
      wave: ['{a} turned to colour today. It was like the island remembered its own name.', 'Colour spilled over {l} like tea into a cup. I watched until it was full.'], fr3: '{f} is my closest friend. We can be quiet together. That is the best kind of friend.', fr: '{f} listens to my poems all the way to the end. Rare. Precious.',
      go: 'Sailed to {d}. The clouds below looked like a sleeping sea.', back: 'Home from {d}. Every island has its own quiet. Ours is the kindest.', blt: 'Helped build {b}. Wrote a small poem on the beam where no one will see it.',
      pup: '{f} was born today. A whole new story, one page long.',
    },
    curious: {
      arr0: 'Woke up under a big grey tree. Why is it grey? Why is it so big? Why does it hum? I have questions.',
      arr: ['Crossed a long bridge to see what was on the other side. It was this! It is great.', 'Arrived. Sniffed seven rocks, two flowers and one very surprised frog.'],
      job: { water: '{n} buckets. Found out the river is colder on the left side. Science!', light: 'Lit the orbs {n} times. Tried to find out where the glow comes from. Still looking.',
        nourish: 'Dug by the roots. Found a button, a shell and a worm called Gerald.', protect: 'Kept watch by the roots. Studied a beetle all afternoon. It studied me back.',
        spirit: 'Tried every instrument. The triangle is harder than it looks.', wood: '{n} loads of logs. Counted the rings on one. It is older than everyone.',
        stone: '{n} loads of stone. One had a tiny shell inside it. How did it get in there?', food: '{n} baskets. Found a berry that is half blue and half red. Kept it.',
        build: 'Building day. Learned how a roof stays up. Mostly by trying to hold one.', rest: 'A rest day. Followed a moth all the way to the river.' },
      wave: ['{a} turned colourful! I ran to see what was under the grey. Flowers! So many!', 'Colour in {l}! I sniffed where it starts. It smells like rain.'], fr3: '{f} is my closest friend. Together we found out the moon follows us home.', fr: '{f} lets me ask ten questions in a row. Sometimes eleven.',
      go: 'Off to {d}! What is up there? I am about to find out.', back: 'Back from {d}. Brought home a pocket full of questions.', blt: 'Helped build {b}. Found out what all the bits are for.',
      pup: '{f} was born today! Already sniffing everything. That is my pup.',
    },
    cuddly: {
      arr0: 'Woke up under a big grey tree and gave it a hug. It is too wide to hug. I hugged it anyway.',
      arr: ['Crossed a long bridge. Everyone here said hello. I said hello back with my whole tail.', 'Arrived today. Found a bed, and somebody to share the warm side with.'],
      job: { water: 'Carried {n} buckets with a friend. Everything is lighter with a friend.', light: 'Lit the orbs {n} times. Each one is like a small warm hug.',
        nourish: 'Patted the soil round the roots. Then patted the roots. They seemed to like it.', protect: 'Kept the roots safe today. Nobody should feel alone in the dark.',
        spirit: 'Played a soft song. Everyone leaned on everyone. Perfect.', wood: '{n} loads of logs. Saved the soft moss for the beds.',
        stone: '{n} loads of stone. Found a warm one in the sun. Sat on it for a while.', food: '{n} baskets of berries. Gave the first ones away. Best part.',
        build: 'Helped build today. A home is just a hug with a roof.', rest: 'Napped in a heap with my friends. Did not know whose paw was whose.' },
      wave: ['{a} turned colourful! I hugged the nearest pup. Then all of them.', 'Colour came to {l}, so we all lay in it together. Warm as a blanket.'], fr3: '{f} is my closest friend. We nap back to back, nose to tail, paw in paw.', fr: '{f} is my favourite pillow and my favourite pup.',
      go: 'Flew to {d}. Held paws with the pup beside me the whole way.', back: 'Home from {d}! Hugged everyone twice.', blt: 'Helped build {b}. Picked the coziest corner for whoever lives there.',
      pup: '{f} was born today. I already know all their sleepy noises.',
    },
    bouncy: {
      arr0: 'Woke up under a big grey tree! Jumped up! Jumped again! The tree did not jump. Maybe tomorrow!',
      arr: ['Bounced over a long bridge! Every plank went boing! Found a bed, bounced on it!', 'Arrived! Ran three circles round the tree to say hello!'],
      job: { water: '{n} buckets! Hopped the whole way! Splashed a bit! Worth it!', light: '{n} lantern trips! Skipped every time!',
        nourish: 'Gardening! Dug so fast the dirt went everywhere! The roots are happy, I think!', protect: 'Guard duty! Patrolled in a zigzag. Nothing can catch a zigzag!',
        spirit: 'Played music ALL DAY! Danced too! Danced while playing! Fell over once!', wood: '{n} loads of logs! Did a little hop for every log!',
        stone: '{n} stones! Rolled one down a hill and chased it! Twice!', food: '{n} baskets! Bounced to reach the top berries!',
        build: 'Building day! Hammer, hammer, hop! Hammer, hammer, hop!', rest: 'Rest day! Rested very fast so I could play more!' },
      wave: ['{a} turned colourful! I rolled in it! Then rolled in it again!', 'Colour in {l}! I raced the edge of it! I lost! I want a rematch!'], fr3: '{f} is my closest friend! Best friend! BEST friend!', fr: '{f} plays tag with me every evening. They always let me win. Almost always!',
      go: 'Off to {d}! The boat bounces too! Best day!', back: 'Back from {d}! Jumped off the boat before it landed! A little bit!', blt: 'Helped build {b}! Tested the floor! It is very boingy!',
      pup: '{f} was born today! Tiny bounces! The tiniest!',
    },
    tidy: {
      arr0: 'Woke up under a big grey tree. Leaves everywhere. Swept a little circle. Much better.',
      arr: ['Crossed a long bridge. Straightened two crooked planks on the way. Found a bed. Made it.', 'Arrived today. Lined up my things by size. Feeling at home already.'],
      job: { water: '{n} buckets, every one filled to exactly the same line.', light: 'Lit the orbs {n} times. Polished the glass while I was there.',
        nourish: 'Weeded around the roots in neat little rows. The tree looks very smart now.', protect: 'Swept the blight away. Swept a bit extra. Just to be sure.',
        spirit: 'Practised scales. Up, down, up, down. Lovely and even.', wood: '{n} loads of logs, stacked biggest at the bottom. As it should be.',
        stone: '{n} loads of stone. Sorted them by colour. Grey, grey and slightly different grey.', food: '{n} baskets of berries, sorted ripe from not quite.',
        build: 'Building day. Measured twice, hammered once. Swept up after.', rest: 'Rest day. Made a little pebble path to my nap spot.' },
      wave: ['{a} turned colourful! Everything is so bright and neat now.', 'Colour came back to {l}, every blade of grass in its place. Lovely.'], fr3: '{f} is my closest friend. Our beds are side by side, both neatly made.', fr: '{f} helps me stack pebbles. They stack them almost straight.',
      go: 'Off to {d}. Packed in order: berries, scarf, more berries.', back: 'Back from {d}. Unpacked straight away. Put everything back where it lives.', blt: 'Helped build {b}. Every nail in a straight line.',
      pup: '{f} was born today. I made them a very neat little bed.',
    },
  };
  // chatter = speech bubbles over a pup (game: on a new job, now and then while you watch, at critters / lanterns, in a moment)
  const CHAT = {
    sleepy: { job: ['{j}? Okay... after a tiny nap.', 'Yawn. On my way to {j}.', 'I will do {j}. Slowly. Beautifully.'], work: ['One more trip, then a nap.', 'Working. Mostly awake.', 'This bucket is heavy and I am sleepy.'],
      rest: ['Zzz... five more minutes...', 'This spot is perfect. Do not tell anyone.', 'Mm. Warm.'], night: ['Night is my favourite. Nap o\'clock.', 'The stars are blinking. Me too.'],
      critter: ['Oh... a visitor. Hello, visitor...', 'Shh. It is sleeping too, I think.'], lantern: ['A floating night light. How kind.', 'Somebody sent us a little moon.'] },
    brave: { job: ['{j}! Leave it to me!', 'Off to {j}. Fear not!', 'I was born for {j}.'], work: ['Nothing is too heavy!', 'Onward!', 'One more! Then one more!'],
      rest: ['Resting. Alert. Ready.', 'Keeping an eye on things.', 'A short rest, then adventure.'], night: ['I will keep watch. You sleep.', 'The dark is just the day resting.'],
      critter: ['A visitor! Stay calm, everyone! I am calm!', 'Do not worry, I will say hello first.'], lantern: ['A lantern! From far away! Brave little thing.', 'It crossed the whole sky to get here!'] },
    foodie: { job: ['{j}? Is there a snack break?', 'Okay, {j}. I packed a berry.', '{j} it is. Then lunch.'], work: ['Working up an appetite!', 'Is it snack time yet?', 'This smells like... nothing. Sad.'],
      rest: ['Thinking about pie.', 'If clouds were food, which one would you eat?', 'Mm, crumbs in my fur. Breakfast later.'], night: ['Midnight snack time?', 'The moon looks like a big cookie.'],
      critter: ['Ooh, a visitor! Do they like berries?', 'Hello! Want to share a snack?'], lantern: ['It looks like a glowing peach!', 'A lantern! Does it have a cookie inside?'] },
    poet: { job: ['{j}. A small kindness for a big tree.', 'I will do {j}, and listen as I go.', '{j}... yes, there is a poem in that.'], work: ['Every bucket holds a little sky.', 'The path knows my paws now.', 'Work is a kind of song.'],
      rest: ['The clouds are writing something.', 'Listen. The leaves are whispering.', 'Some days are for watching.'], night: ['The stars are old friends.', 'Night is the island dreaming.'],
      critter: ['Oh, look. Something wild and gentle.', 'Shh. Let us not frighten the poem.'], lantern: ['Someone, somewhere, thought of us.', 'A little light that crossed the dark.'] },
    curious: { job: ['{j}? What is {j} like? Let me find out!', 'Ooh, {j}! I have questions!', '{j}! Is there anything to sniff there?'], work: ['Why is the water wet?', 'I counted the steps. It is 212.', 'What is under this rock?'],
      rest: ['What is that smell?', 'A beetle! Hello, beetle!', 'Where do clouds go at night?'], night: ['Why do fireflies blink?', 'How far away is the moon? Far?'],
      critter: ['What IS that? I need a closer look!', 'Oh! Oh! Can I touch it? I will not touch it.'], lantern: ['Where did it come from? Who made it?', 'Is it hot? Is it paper? Is it magic?'] },
    cuddly: { job: ['{j}! Will you come too?', 'Okay, {j}. Hugs after?', '{j} with friends is the best {j}.'], work: ['Almost done, then cuddles.', 'Teamwork!', 'You are doing great!'],
      rest: ['Scoot over, there is room.', 'Warm spot! Come here!', 'Everyone is here. Perfect.'], night: ['Group nap?', 'Goodnight, everyone. Goodnight, tree.'],
      critter: ['A visitor! Can it stay for a cuddle?', 'Hello, little friend!'], lantern: ['Someone sent us a hug!', 'A warm little light. I love it.'] },
    bouncy: { job: ['{j}! Yes! Let\'s go!', '{j}! Race you there!', 'Woo, {j}!'], work: ['Hop, hop, hop!', 'Faster! Faster!', 'Wheee!'],
      rest: ['Can we play tag?', 'I am resting! Very fast!', 'Tag! You\'re it!'], night: ['Is it morning yet? Is it now?', 'Night tag! Glow-in-the-dark tag!'],
      critter: ['A visitor! A visitor! Hi! Hi!', 'Look look look!'], lantern: ['A lantern! It\'s flying! I want to fly!', 'Wheee, it goes up and up!'] },
    tidy: { job: ['{j}. Right away, and properly.', 'I will make {j} very neat.', '{j}. I have a system.'], work: ['Everything in its place.', 'Neat and steady.', 'One at a time. Nicely.'],
      rest: ['These pebbles want to be in a row.', 'A tidy nap spot is a happy nap spot.', 'Just straightening the grass.'], night: ['Lights out. Everything put away.', 'Folded my scarf. Goodnight.'],
      critter: ['A visitor! Wipe your paws, please.', 'Oh, welcome! Mind the flowers.'], lantern: ['How neatly it floats.', 'A lantern. Lovely paper folds.'] },
  };
  // a moment (src/pup_life.js vignettes): a few shared lines + the pup's trait voice where it fits
  const MOMENT = {
    bench: ['Good bench. Ten out of ten.', 'Paws dangling. Life is good.', 'Just sitting. Very important.'],
    river: ['The river is telling a long story.', 'Little fish! Hello, little fish!', 'Plip. Plop. Plip.'],
    bridge: ['Paws over the water. Best seat.', 'I can see my reflection waving.', 'Every bridge is a good place to think.'],
    fire: ['Warm toes, warm heart.', 'Tell the one about the sky whale!', 'Crackle crackle.'],
    moth: ['Come back! I just want to say hi!', 'So fluttery!', 'Almost... almost...'],
    snow: ['Snowball fight!', 'Got you!', 'Cold paws! Worth it!'],
    nap: ['Zzz...', 'Back to back. Best way to nap.', 'Mm... warm...'],
    tumble: ['Tumble!', 'Gotcha!', 'Again! Again!'],
    stars: ['That one is a pup. See? The tail?', 'Make a wish.', 'So many...'],
    curio: ['It woke up when the colour came.', 'I think it was waiting for us.', 'Hello, old thing.'],
  };
  const fill = (x, o) => x.replace(/\{(\w)\}/g, (m, k) => (o && o[k] !== undefined ? o[k] : m));
  // a diary line for kind (or null = use the shared pool); h = the entry's hash
  function diary(t, kind, job, h, o) {
    const D = DIARY[t]; if (!D) return null;
    if (kind === 'arr0') return D.arr0;
    if (kind === 'arr') return D.arr[h % D.arr.length];
    if (kind === 'job') return D.job[job] ? fill(D.job[job], o) : null;
    const x = D[kind]; return x ? fill(Array.isArray(x) ? x[h % x.length] : x, o) : null;
  }
  // chatter: kind job | work | rest | night | critter | lantern | moment:<name>; h = any number (the game passes a counter)
  function chat(t, kind, h, o) {
    h = h >>> 0;
    if (kind.startsWith('moment:')) { const L = MOMENT[kind.slice(7)] || MOMENT.bench, T = CHAT[t]; return h % 3 === 0 && T ? fill(T.rest[h % T.rest.length], o) : L[(h >>> 2) % L.length]; }
    const T = CHAT[t] || CHAT.curious, L = T[kind] || T.rest; return fill(L[h % L.length], o).replace(/^./, c => c.toUpperCase());
  }
  window.Traits = { K, START, INFO, NAP, FAV, C, JOBW, DIARY, CHAT, MOMENT, pick, of, napK, like, diary, chat, hash };
})();
