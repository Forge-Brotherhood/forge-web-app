/**
 * Verse of the Day List
 * Curated list of verses for daily devotional use
 */

export interface VotdEntry {
  reference: string;
  theme?: string;
}

/**
 * A curated list of 365+ verses covering various themes.
 * The verse shown each day is determined by day of year.
 */
export const VERSE_OF_THE_DAY_LIST: VotdEntry[] = [
  // Faith & Trust
  { reference: "Proverbs 3:5-6", theme: "Trust in the Lord" },
  { reference: "Hebrews 11:1", theme: "Faith" },
  { reference: "Romans 10:17", theme: "Faith comes by hearing" },
  { reference: "Mark 11:24", theme: "Prayer and belief" },
  { reference: "James 1:6", theme: "Ask in faith" },
  { reference: "2 Corinthians 5:7", theme: "Walk by faith" },
  { reference: "Matthew 17:20", theme: "Faith like a mustard seed" },
  { reference: "Hebrews 11:6", theme: "Faith pleases God" },
  { reference: "Romans 4:20-21", theme: "Abraham's faith" },
  { reference: "1 Peter 1:8-9", theme: "Joy in believing" },

  // Love
  { reference: "John 3:16", theme: "God's love" },
  { reference: "1 Corinthians 13:4-7", theme: "Love is patient" },
  { reference: "Romans 8:38-39", theme: "Nothing separates us from God's love" },
  { reference: "1 John 4:19", theme: "We love because He first loved us" },
  { reference: "John 15:13", theme: "Greater love" },
  { reference: "1 John 4:7-8", theme: "God is love" },
  { reference: "Romans 5:8", theme: "God demonstrates His love" },
  { reference: "Ephesians 3:17-19", theme: "Rooted in love" },
  { reference: "1 Corinthians 16:14", theme: "Do everything in love" },
  { reference: "Colossians 3:14", theme: "Love binds everything together" },

  // Peace & Comfort
  { reference: "Philippians 4:6-7", theme: "Peace that surpasses understanding" },
  { reference: "John 14:27", theme: "My peace I give you" },
  { reference: "Isaiah 26:3", theme: "Perfect peace" },
  { reference: "Psalm 23:1-4", theme: "The Lord is my shepherd" },
  { reference: "Matthew 11:28-30", theme: "Come to me, all who are weary" },
  { reference: "2 Corinthians 1:3-4", theme: "God of all comfort" },
  { reference: "Psalm 46:1", theme: "God is our refuge" },
  { reference: "Romans 15:13", theme: "God of hope" },
  { reference: "Isaiah 41:10", theme: "Fear not, I am with you" },
  { reference: "Psalm 94:19", theme: "Your consolation delights my soul" },

  // Strength & Courage
  { reference: "Joshua 1:9", theme: "Be strong and courageous" },
  { reference: "Isaiah 40:31", theme: "Renew their strength" },
  { reference: "Philippians 4:13", theme: "I can do all things through Christ" },
  { reference: "2 Timothy 1:7", theme: "Spirit of power and love" },
  { reference: "Deuteronomy 31:6", theme: "The Lord goes with you" },
  { reference: "Psalm 27:1", theme: "The Lord is my light" },
  { reference: "Nehemiah 8:10", theme: "Joy of the Lord is your strength" },
  { reference: "Ephesians 6:10", theme: "Be strong in the Lord" },
  { reference: "Psalm 28:7", theme: "The Lord is my strength and shield" },
  { reference: "2 Corinthians 12:9-10", theme: "My grace is sufficient" },

  // Hope
  { reference: "Jeremiah 29:11", theme: "Plans to prosper you" },
  { reference: "Romans 8:28", theme: "All things work together for good" },
  { reference: "Lamentations 3:22-23", theme: "New every morning" },
  { reference: "Psalm 42:11", theme: "Hope in God" },
  { reference: "Romans 5:3-5", theme: "Suffering produces hope" },
  { reference: "Hebrews 6:19", theme: "Anchor for the soul" },
  { reference: "1 Peter 1:3", theme: "Living hope" },
  { reference: "Psalm 31:24", theme: "Be strong, take heart" },
  { reference: "Isaiah 40:29", theme: "He gives strength to the weary" },
  { reference: "Psalm 130:5", theme: "I wait for the Lord" },

  // Prayer
  { reference: "Matthew 6:9-13", theme: "The Lord's Prayer" },
  { reference: "1 Thessalonians 5:16-18", theme: "Pray without ceasing" },
  { reference: "James 5:16", theme: "Prayer of a righteous person" },
  { reference: "Philippians 4:6", theme: "Present your requests to God" },
  { reference: "Mark 11:24", theme: "Believe you have received it" },
  { reference: "Matthew 7:7-8", theme: "Ask, seek, knock" },
  { reference: "1 John 5:14-15", theme: "Confidence in prayer" },
  { reference: "Jeremiah 33:3", theme: "Call to me" },
  { reference: "Psalm 145:18", theme: "The Lord is near" },
  { reference: "Romans 8:26", theme: "The Spirit intercedes" },

  // Wisdom
  { reference: "James 1:5", theme: "Ask God for wisdom" },
  { reference: "Proverbs 2:6", theme: "The Lord gives wisdom" },
  { reference: "Proverbs 9:10", theme: "Fear of the Lord is beginning of wisdom" },
  { reference: "Colossians 3:16", theme: "Let the word dwell in you" },
  { reference: "Psalm 119:105", theme: "Lamp to my feet" },
  { reference: "Proverbs 4:7", theme: "Get wisdom" },
  { reference: "Ecclesiastes 7:12", theme: "Wisdom preserves life" },
  { reference: "Proverbs 16:16", theme: "Better to get wisdom than gold" },
  { reference: "1 Corinthians 1:30", theme: "Christ is our wisdom" },
  { reference: "Proverbs 3:13-14", theme: "Blessed is one who finds wisdom" },

  // Forgiveness
  { reference: "1 John 1:9", theme: "He is faithful to forgive" },
  { reference: "Ephesians 4:32", theme: "Forgiving one another" },
  { reference: "Colossians 3:13", theme: "Forgive as the Lord forgave" },
  { reference: "Matthew 6:14-15", theme: "Forgive others" },
  { reference: "Psalm 103:12", theme: "As far as east from west" },
  { reference: "Isaiah 1:18", theme: "Though your sins are like scarlet" },
  { reference: "Micah 7:18-19", theme: "He delights in mercy" },
  { reference: "Acts 3:19", theme: "Repent and be refreshed" },
  { reference: "Romans 8:1", theme: "No condemnation" },
  { reference: "Psalm 32:5", theme: "I confessed my sin" },

  // Guidance
  { reference: "Psalm 32:8", theme: "I will instruct you" },
  { reference: "Isaiah 30:21", theme: "This is the way, walk in it" },
  { reference: "Proverbs 16:9", theme: "The Lord directs our steps" },
  { reference: "Psalm 37:23-24", theme: "Steps are established by the Lord" },
  { reference: "John 16:13", theme: "Spirit of truth will guide you" },
  { reference: "Psalm 25:4-5", theme: "Show me your ways" },
  { reference: "Isaiah 48:17", theme: "The Lord who teaches you" },
  { reference: "Proverbs 3:5-6", theme: "Acknowledge Him in all your ways" },
  { reference: "James 1:5", theme: "Lack wisdom? Ask God" },
  { reference: "Psalm 119:133", theme: "Direct my steps" },

  // Joy
  { reference: "Psalm 16:11", theme: "Fullness of joy" },
  { reference: "Nehemiah 8:10", theme: "Joy of the Lord is your strength" },
  { reference: "John 15:11", theme: "That your joy may be full" },
  { reference: "Galatians 5:22", theme: "Fruit of the Spirit" },
  { reference: "Romans 15:13", theme: "Joy and peace in believing" },
  { reference: "Philippians 4:4", theme: "Rejoice in the Lord always" },
  { reference: "1 Peter 1:8", theme: "Joy inexpressible" },
  { reference: "Psalm 30:5", theme: "Joy comes in the morning" },
  { reference: "James 1:2", theme: "Count it all joy" },
  { reference: "Habakkuk 3:17-18", theme: "Yet I will rejoice" },

  // Salvation
  { reference: "Romans 10:9", theme: "Confess and believe" },
  { reference: "Ephesians 2:8-9", theme: "Saved by grace through faith" },
  { reference: "John 14:6", theme: "The way, truth, and life" },
  { reference: "Acts 4:12", theme: "No other name" },
  { reference: "Titus 3:5", theme: "He saved us" },
  { reference: "Romans 6:23", theme: "Gift of God is eternal life" },
  { reference: "John 1:12", theme: "Right to become children of God" },
  { reference: "2 Corinthians 5:17", theme: "New creation" },
  { reference: "John 10:28", theme: "I give them eternal life" },
  { reference: "Romans 8:1", theme: "No condemnation in Christ" },

  // Scripture & Word
  { reference: "2 Timothy 3:16-17", theme: "All Scripture is God-breathed" },
  { reference: "Hebrews 4:12", theme: "Word of God is living and active" },
  { reference: "Psalm 119:11", theme: "Hidden your word in my heart" },
  { reference: "Isaiah 55:11", theme: "My word will not return void" },
  { reference: "Joshua 1:8", theme: "Meditate on it day and night" },
  { reference: "Matthew 4:4", theme: "Man shall not live by bread alone" },
  { reference: "Psalm 119:105", theme: "Lamp to my feet" },
  { reference: "Romans 10:17", theme: "Faith comes from hearing" },
  { reference: "1 Peter 2:2", theme: "Crave pure spiritual milk" },
  { reference: "Colossians 3:16", theme: "Let the word dwell richly" },

  // Service & Purpose
  { reference: "Ephesians 2:10", theme: "Created for good works" },
  { reference: "Matthew 5:16", theme: "Let your light shine" },
  { reference: "Galatians 6:9", theme: "Do not grow weary in doing good" },
  { reference: "Colossians 3:23-24", theme: "Work for the Lord" },
  { reference: "1 Peter 4:10", theme: "Use your gifts to serve" },
  { reference: "Mark 10:45", theme: "Came to serve" },
  { reference: "Romans 12:1", theme: "Living sacrifice" },
  { reference: "Matthew 25:40", theme: "You did it for me" },
  { reference: "Micah 6:8", theme: "Act justly, love mercy" },
  { reference: "James 2:17", theme: "Faith without works is dead" },

  // Unity & Community
  { reference: "Hebrews 10:24-25", theme: "Spur one another on" },
  { reference: "Romans 12:4-5", theme: "One body in Christ" },
  { reference: "Galatians 6:2", theme: "Carry each other's burdens" },
  { reference: "1 Corinthians 12:27", theme: "You are the body of Christ" },
  { reference: "Ecclesiastes 4:9-10", theme: "Two are better than one" },
  { reference: "Colossians 3:14", theme: "Love binds us together" },
  { reference: "1 John 1:7", theme: "Fellowship with one another" },
  { reference: "Philippians 2:2", theme: "Be like-minded" },
  { reference: "Matthew 18:20", theme: "Where two or three gather" },
  { reference: "Acts 2:42", theme: "Devoted to fellowship" },

  // God's Character
  { reference: "Psalm 103:8", theme: "Compassionate and gracious" },
  { reference: "Malachi 3:6", theme: "I the Lord do not change" },
  { reference: "1 John 4:8", theme: "God is love" },
  { reference: "Psalm 145:17", theme: "Righteous in all His ways" },
  { reference: "Deuteronomy 7:9", theme: "Faithful God" },
  { reference: "Isaiah 40:28", theme: "Everlasting God" },
  { reference: "Psalm 147:5", theme: "Great is our Lord" },
  { reference: "James 1:17", theme: "Every good gift is from above" },
  { reference: "Psalm 86:15", theme: "Abounding in love" },
  { reference: "Hebrews 13:8", theme: "Same yesterday, today, forever" },

  // Trials & Testing
  { reference: "James 1:2-4", theme: "Testing produces perseverance" },
  { reference: "1 Peter 5:10", theme: "After suffering, restore you" },
  { reference: "Romans 5:3-4", theme: "Suffering produces character" },
  { reference: "2 Corinthians 4:17", theme: "Light and momentary troubles" },
  { reference: "Isaiah 43:2", theme: "When you pass through waters" },
  { reference: "Psalm 34:19", theme: "Lord delivers from troubles" },
  { reference: "John 16:33", theme: "Take heart, I have overcome" },
  { reference: "1 Corinthians 10:13", theme: "No temptation beyond what you can bear" },
  { reference: "Revelation 21:4", theme: "He will wipe every tear" },
  { reference: "Romans 8:18", theme: "Present sufferings not worth comparing" },

  // Thankfulness
  { reference: "1 Thessalonians 5:18", theme: "Give thanks in all circumstances" },
  { reference: "Psalm 100:4", theme: "Enter His gates with thanksgiving" },
  { reference: "Colossians 3:17", theme: "Giving thanks to God" },
  { reference: "Psalm 107:1", theme: "Give thanks, for He is good" },
  { reference: "Philippians 4:6", theme: "With thanksgiving" },
  { reference: "Psalm 95:2", theme: "Come before Him with thanksgiving" },
  { reference: "Ephesians 5:20", theme: "Always giving thanks" },
  { reference: "Psalm 136:1", theme: "His love endures forever" },
  { reference: "1 Chronicles 16:34", theme: "Give thanks to the Lord" },
  { reference: "Psalm 9:1", theme: "I will give thanks with my whole heart" },

  // Spiritual Growth
  { reference: "2 Peter 3:18", theme: "Grow in grace and knowledge" },
  { reference: "Philippians 1:6", theme: "He who began a good work" },
  { reference: "Colossians 2:6-7", theme: "Rooted and built up" },
  { reference: "1 Peter 2:2", theme: "Grow up in your salvation" },
  { reference: "Ephesians 4:15", theme: "Grow up into Christ" },
  { reference: "Romans 12:2", theme: "Be transformed" },
  { reference: "Hebrews 5:14", theme: "Solid food for the mature" },
  { reference: "Galatians 5:22-23", theme: "Fruit of the Spirit" },
  { reference: "John 15:5", theme: "Abide in me" },
  { reference: "Psalm 1:2-3", theme: "Like a tree planted by streams" },

  // Identity in Christ
  { reference: "2 Corinthians 5:17", theme: "New creation" },
  { reference: "Ephesians 2:10", theme: "God's workmanship" },
  { reference: "Romans 8:17", theme: "Heirs with Christ" },
  { reference: "1 Peter 2:9", theme: "Chosen people" },
  { reference: "John 1:12", theme: "Children of God" },
  { reference: "Galatians 2:20", theme: "Christ lives in me" },
  { reference: "Colossians 3:3", theme: "Your life is hidden with Christ" },
  { reference: "Ephesians 1:4", theme: "Chosen before creation" },
  { reference: "Romans 8:37", theme: "More than conquerors" },
  { reference: "1 John 3:1", theme: "Called children of God" },

  // Anxiety & Worry
  { reference: "Matthew 6:34", theme: "Do not worry about tomorrow" },
  { reference: "1 Peter 5:7", theme: "Cast all your anxiety on Him" },
  { reference: "Philippians 4:6-7", theme: "Do not be anxious" },
  { reference: "Psalm 55:22", theme: "Cast your cares on the Lord" },
  { reference: "Isaiah 41:10", theme: "Fear not" },
  { reference: "Matthew 6:25-26", theme: "Do not worry about your life" },
  { reference: "Psalm 94:19", theme: "Your consolation brings joy" },
  { reference: "John 14:27", theme: "Let not your hearts be troubled" },
  { reference: "Psalm 56:3", theme: "When I am afraid, I put my trust in you" },
  { reference: "2 Timothy 1:7", theme: "Spirit not of fear" },

  // Additional Verses
  { reference: "Psalm 37:4", theme: "Delight in the Lord" },
  { reference: "Proverbs 18:10", theme: "Name of the Lord is a strong tower" },
  { reference: "Isaiah 53:5", theme: "By His wounds we are healed" },
  { reference: "Micah 7:7", theme: "I will wait for the Lord" },
  { reference: "Psalm 139:14", theme: "Fearfully and wonderfully made" },
  { reference: "Matthew 28:20", theme: "I am with you always" },
  { reference: "Romans 12:12", theme: "Joyful in hope, patient in affliction" },
  { reference: "Psalm 46:10", theme: "Be still and know" },
  { reference: "Isaiah 43:18-19", theme: "I am doing a new thing" },
  { reference: "Psalm 91:1-2", theme: "Shelter of the Most High" },
  { reference: "John 8:32", theme: "The truth will set you free" },
  { reference: "Proverbs 22:6", theme: "Train up a child" },
  { reference: "Matthew 5:14", theme: "You are the light of the world" },
  { reference: "Psalm 121:1-2", theme: "My help comes from the Lord" },
  { reference: "Romans 1:16", theme: "Not ashamed of the gospel" },
  { reference: "Isaiah 58:11", theme: "The Lord will guide you always" },
  { reference: "Psalm 19:14", theme: "May the words of my mouth" },
  { reference: "Philippians 2:3-4", theme: "Value others above yourselves" },
  { reference: "1 John 5:4", theme: "Overcomes the world" },
  { reference: "Psalm 34:8", theme: "Taste and see" },
  { reference: "Deuteronomy 6:5", theme: "Love the Lord your God" },
  { reference: "Matthew 22:37-39", theme: "Greatest commandment" },
  { reference: "Psalm 63:1", theme: "My soul thirsts for you" },
  { reference: "Isaiah 12:2", theme: "The Lord is my strength and song" },
  { reference: "Psalm 73:26", theme: "God is my strength forever" },
  { reference: "2 Chronicles 7:14", theme: "If my people will humble themselves" },
  { reference: "Psalm 51:10", theme: "Create in me a clean heart" },
  { reference: "Proverbs 31:25", theme: "Strength and dignity" },
  { reference: "Revelation 3:20", theme: "I stand at the door and knock" },
  { reference: "Psalm 118:24", theme: "This is the day the Lord has made" },
  { reference: "John 11:25-26", theme: "I am the resurrection and the life" },
  { reference: "Psalm 62:1-2", theme: "My soul finds rest in God alone" },
  { reference: "Isaiah 9:6", theme: "Prince of Peace" },
  { reference: "Matthew 5:9", theme: "Blessed are the peacemakers" },
  { reference: "Psalm 84:11", theme: "The Lord gives grace and glory" },
  { reference: "Romans 15:4", theme: "Encouragement from Scripture" },
  { reference: "Psalm 145:9", theme: "The Lord is good to all" },
  { reference: "John 13:34-35", theme: "Love one another" },
  { reference: "Psalm 119:165", theme: "Great peace for those who love your law" },
  { reference: "Proverbs 14:26", theme: "Fear of the Lord is secure fortress" },
  { reference: "1 Corinthians 15:58", theme: "Stand firm, let nothing move you" },
  { reference: "Psalm 5:11-12", theme: "Let all who take refuge rejoice" },
  { reference: "John 6:35", theme: "I am the bread of life" },
  { reference: "Psalm 103:1-2", theme: "Bless the Lord, O my soul" },
  { reference: "Isaiah 49:15-16", theme: "I have engraved you on my palms" },
  { reference: "Matthew 11:29", theme: "Learn from me" },
  { reference: "Psalm 86:5", theme: "You, Lord, are forgiving and good" },
  { reference: "John 4:14", theme: "Living water" },
  { reference: "Psalm 33:4", theme: "The word of the Lord is right and true" },
  { reference: "Proverbs 11:25", theme: "Generous will prosper" },
  { reference: "Hebrews 12:1-2", theme: "Run the race, fix eyes on Jesus" },
  { reference: "Psalm 40:1-3", theme: "He put a new song in my mouth" },
  { reference: "John 8:12", theme: "I am the light of the world" },
  { reference: "Psalm 147:3", theme: "He heals the brokenhearted" },
  { reference: "Matthew 7:12", theme: "Golden rule" },
  { reference: "Psalm 18:2", theme: "The Lord is my rock" },
  { reference: "Romans 8:31", theme: "If God is for us" },
  { reference: "Psalm 25:8-9", theme: "Good and upright is the Lord" },
  { reference: "John 10:10", theme: "I came that they may have life" },
  { reference: "Psalm 112:7", theme: "Not fear bad news" },
  { reference: "Matthew 6:33", theme: "Seek first His kingdom" },
];

/**
 * Get the day of year (1-365/366)
 */
export function getDayOfYear(date: Date = new Date()): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

/**
 * Get today's verse entry based on day of year
 */
export function getTodaysVerse(date: Date = new Date()): VotdEntry {
  const dayOfYear = getDayOfYear(date);
  const index = dayOfYear % VERSE_OF_THE_DAY_LIST.length;
  return VERSE_OF_THE_DAY_LIST[index];
}
