export const places: Record<string, Record<string, string[]>> = {
  Gujarat: {
    Ahmedabad: ["Navrangpura", "Vastrapur", "Satellite", "Bodakdev", "Maninagar", "Paldi"],
    Surat: ["Adajan", "Vesu", "Athwa", "Katargam"],
    Vadodara: ["Alkapuri", "Gotri", "Manjalpur"],
    Rajkot: ["Kalawad Road", "Raiya Road", "Gondal Road"],
  },
  Maharashtra: {
    Mumbai: ["Bandra", "Andheri", "Dadar", "Powai", "Borivali"],
    Pune: ["Kothrud", "Baner", "Wakad", "Koregaon Park"],
    Nagpur: ["Dharampeth", "Sitabuldi", "Manish Nagar"],
  },
  Karnataka: {
    Bengaluru: ["Indiranagar", "Koramangala", "Whitefield", "Jayanagar", "HSR Layout"],
    Mysuru: ["Gokulam", "Vijayanagar", "Kuvempunagar"],
  },
  Delhi: { "New Delhi": ["Connaught Place", "Dwarka", "Rohini", "Saket", "Karol Bagh"] },
  Rajasthan: { Jaipur: ["Vaishali Nagar", "Malviya Nagar", "Mansarovar"], Udaipur: ["Hiran Magri", "Fatehpura"] },
  "Tamil Nadu": { Chennai: ["T Nagar", "Adyar", "Anna Nagar", "Velachery"], Coimbatore: ["RS Puram", "Peelamedu"] },
  Telangana: { Hyderabad: ["Banjara Hills", "Gachibowli", "Kukatpally", "Secunderabad"] },
  "West Bengal": { Kolkata: ["Salt Lake", "Park Street", "New Town", "Ballygunge"] },
  "Uttar Pradesh": { Lucknow: ["Gomti Nagar", "Hazratganj", "Aliganj"], Noida: ["Sector 18", "Sector 62", "Sector 137"] },
  "Madhya Pradesh": { Indore: ["Vijay Nagar", "Palasia", "Rau"], Bhopal: ["Arera Colony", "MP Nagar"] },
  Kerala: { Kochi: ["Kakkanad", "Fort Kochi", "Edappally"], Thiruvananthapuram: ["Kowdiar", "Kazhakkoottam"] },
  Punjab: { Ludhiana: ["Model Town", "Sarabha Nagar"], Amritsar: ["Ranjit Avenue", "Lawrence Road"] },
  Haryana: { Gurugram: ["DLF Phase 1", "Sector 56", "Sohna Road"], Faridabad: ["Sector 15", "NIT"] },
  Bihar: { Patna: ["Boring Road", "Kankarbagh", "Patliputra"] },
  Odisha: { Bhubaneswar: ["Patia", "Saheed Nagar", "Jaydev Vihar"] },
  Assam: { Guwahati: ["Dispur", "Beltola", "Paltan Bazaar"] },
};

const matrix: Record<number, number[]> = {
  3: [299, 599, 1499], 7: [699, 1499, 3499],
  15: [1299, 2799, 6999], 30: [2199, 4999, 12999],
};
export const adPlans = Object.entries(matrix).flatMap(([days, prices]) =>
  (["local", "state", "national"] as const).map((reach, index) => ({
    id: `${days}-${reach}`, days: Number(days), reach, price: prices[index]!,
    label: ["50 KM", "State-wide", "National"][index]!,
  })),
);

// Explicit showcase content, never mixed with the live geofenced feed.
export const exploreFeed = {
  source: "demo" as const,
  message: "Sample neighborhood stories. Sign in and enable GPS to see real posts within 5 km.",
  posts: [
    {
      id: "sample-market", authorId: "sample-kavya", authorName: "Kavya Patel", avatar: "",
      verified: false, caption: "The best part of an early morning? Fresh flowers, familiar faces, and our neighborhood coming to life.",
      category: "market", mediaType: "image" as const, mediaUrl: "/images/neighborhood-market.png",
      posterUrl: "/images/neighborhood-market.png", area: "Navrangpura", city: "Ahmedabad", state: "Gujarat",
      distanceKm: null, likes: 0, comments: 0, liked: false, createdAt: "2026-10-01T03:30:00Z", isAd: false,
    },
    {
      id: "sample-food", authorId: "sample-arjun", authorName: "Arjun Shah", avatar: "",
      verified: false, caption: "A little chai, a little conversation. Who else has a favorite spot around the corner?",
      category: "food", mediaType: "video" as const, mediaUrl: "/images/neighborhood-food.mp4",
      posterUrl: "/images/neighborhood-food.png", area: "Vastrapur", city: "Ahmedabad", state: "Gujarat",
      distanceKm: null, likes: 0, comments: 0, liked: false, createdAt: "2026-10-01T04:00:00Z", isAd: false,
    },
    {
      id: "sample-community", authorId: "sample-meera", authorName: "Meera Joshi", avatar: "",
      verified: false, caption: "Small steps, a greener neighborhood. Imagine a weekend planting drive with the people who live next door.",
      category: "moment", mediaType: "image" as const, mediaUrl: "/images/neighborhood-community.png",
      posterUrl: "/images/neighborhood-community.png", area: "Paldi", city: "Ahmedabad", state: "Gujarat",
      distanceKm: null, likes: 0, comments: 0, liked: false, createdAt: "2026-10-01T05:00:00Z", isAd: false,
    },
  ],
};