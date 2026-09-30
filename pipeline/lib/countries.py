"""
Country reference: one canonical ISO3 key for every dataset we join.

Regions follow the Energy Institute (EI) Statistical Review groupings so that our
regional totals reconcile with EI's published "Total <region>" rows.
"""

from __future__ import annotations

# ISO3 | ISO2 | ISO numeric | display name | EI region
# Regions: NAM North America, SCA S. & Cent. America, EUR Europe, CIS, ME Middle East,
#          AFR Africa, APAC Asia Pacific, ANT Antarctica/uninhabited
_TABLE = """
AFG|AF|004|Afghanistan|APAC
ALB|AL|008|Albania|EUR
DZA|DZ|012|Algeria|AFR
ASM|AS|016|American Samoa|APAC
AND|AD|020|Andorra|EUR
AGO|AO|024|Angola|AFR
ATG|AG|028|Antigua and Barbuda|SCA
AZE|AZ|031|Azerbaijan|CIS
ARG|AR|032|Argentina|SCA
AUS|AU|036|Australia|APAC
AUT|AT|040|Austria|EUR
BHS|BS|044|Bahamas|SCA
BHR|BH|048|Bahrain|ME
BGD|BD|050|Bangladesh|APAC
ARM|AM|051|Armenia|CIS
BRB|BB|052|Barbados|SCA
BEL|BE|056|Belgium|EUR
BMU|BM|060|Bermuda|NAM
BTN|BT|064|Bhutan|APAC
BOL|BO|068|Bolivia|SCA
BIH|BA|070|Bosnia and Herzegovina|EUR
BWA|BW|072|Botswana|AFR
BRA|BR|076|Brazil|SCA
BLZ|BZ|084|Belize|SCA
IOT|IO|086|British Indian Ocean Territory|APAC
SLB|SB|090|Solomon Islands|APAC
VGB|VG|092|British Virgin Islands|SCA
BRN|BN|096|Brunei|APAC
BGR|BG|100|Bulgaria|EUR
MMR|MM|104|Myanmar|APAC
BDI|BI|108|Burundi|AFR
BLR|BY|112|Belarus|CIS
KHM|KH|116|Cambodia|APAC
CMR|CM|120|Cameroon|AFR
CAN|CA|124|Canada|NAM
CPV|CV|132|Cabo Verde|AFR
CYM|KY|136|Cayman Islands|SCA
CAF|CF|140|Central African Republic|AFR
LKA|LK|144|Sri Lanka|APAC
TCD|TD|148|Chad|AFR
CHL|CL|152|Chile|SCA
CHN|CN|156|China|APAC
TWN|TW|158|Taiwan|APAC
COL|CO|170|Colombia|SCA
COM|KM|174|Comoros|AFR
COG|CG|178|Republic of the Congo|AFR
COD|CD|180|DR Congo|AFR
COK|CK|184|Cook Islands|APAC
CRI|CR|188|Costa Rica|SCA
HRV|HR|191|Croatia|EUR
CUB|CU|192|Cuba|SCA
CYP|CY|196|Cyprus|EUR
CZE|CZ|203|Czechia|EUR
BEN|BJ|204|Benin|AFR
DNK|DK|208|Denmark|EUR
DMA|DM|212|Dominica|SCA
DOM|DO|214|Dominican Republic|SCA
ECU|EC|218|Ecuador|SCA
SLV|SV|222|El Salvador|SCA
GNQ|GQ|226|Equatorial Guinea|AFR
ETH|ET|231|Ethiopia|AFR
ERI|ER|232|Eritrea|AFR
EST|EE|233|Estonia|EUR
FRO|FO|234|Faroe Islands|EUR
FLK|FK|238|Falkland Islands|SCA
SGS|GS|239|South Georgia|ANT
FJI|FJ|242|Fiji|APAC
FIN|FI|246|Finland|EUR
ALA|AX|248|Åland|EUR
FRA|FR|250|France|EUR
PYF|PF|258|French Polynesia|APAC
ATF|TF|260|French Southern Lands|ANT
DJI|DJ|262|Djibouti|AFR
GAB|GA|266|Gabon|AFR
GEO|GE|268|Georgia|EUR
GMB|GM|270|Gambia|AFR
PSE|PS|275|Palestine|ME
DEU|DE|276|Germany|EUR
GHA|GH|288|Ghana|AFR
KIR|KI|296|Kiribati|APAC
GRC|GR|300|Greece|EUR
GRL|GL|304|Greenland|NAM
GRD|GD|308|Grenada|SCA
GUM|GU|316|Guam|APAC
GTM|GT|320|Guatemala|SCA
GIN|GN|324|Guinea|AFR
GUY|GY|328|Guyana|SCA
HTI|HT|332|Haiti|SCA
HMD|HM|334|Heard and McDonald Islands|ANT
VAT|VA|336|Vatican City|EUR
HND|HN|340|Honduras|SCA
HKG|HK|344|Hong Kong|APAC
HUN|HU|348|Hungary|EUR
ISL|IS|352|Iceland|EUR
IND|IN|356|India|APAC
IDN|ID|360|Indonesia|APAC
IRN|IR|364|Iran|ME
IRQ|IQ|368|Iraq|ME
IRL|IE|372|Ireland|EUR
ISR|IL|376|Israel|ME
ITA|IT|380|Italy|EUR
CIV|CI|384|Côte d'Ivoire|AFR
JAM|JM|388|Jamaica|SCA
JPN|JP|392|Japan|APAC
KAZ|KZ|398|Kazakhstan|CIS
JOR|JO|400|Jordan|ME
KEN|KE|404|Kenya|AFR
PRK|KP|408|North Korea|APAC
KOR|KR|410|South Korea|APAC
KWT|KW|414|Kuwait|ME
KGZ|KG|417|Kyrgyzstan|CIS
LAO|LA|418|Laos|APAC
LBN|LB|422|Lebanon|ME
LSO|LS|426|Lesotho|AFR
LVA|LV|428|Latvia|EUR
LBR|LR|430|Liberia|AFR
LBY|LY|434|Libya|AFR
LIE|LI|438|Liechtenstein|EUR
LTU|LT|440|Lithuania|EUR
LUX|LU|442|Luxembourg|EUR
MAC|MO|446|Macao|APAC
MDG|MG|450|Madagascar|AFR
MWI|MW|454|Malawi|AFR
MYS|MY|458|Malaysia|APAC
MDV|MV|462|Maldives|APAC
MLI|ML|466|Mali|AFR
MLT|MT|470|Malta|EUR
MRT|MR|478|Mauritania|AFR
MUS|MU|480|Mauritius|AFR
MEX|MX|484|Mexico|NAM
MCO|MC|492|Monaco|EUR
MNG|MN|496|Mongolia|APAC
MDA|MD|498|Moldova|CIS
MNE|ME|499|Montenegro|EUR
MSR|MS|500|Montserrat|SCA
MAR|MA|504|Morocco|AFR
MOZ|MZ|508|Mozambique|AFR
OMN|OM|512|Oman|ME
NAM|NA|516|Namibia|AFR
NRU|NR|520|Nauru|APAC
NPL|NP|524|Nepal|APAC
NLD|NL|528|Netherlands|EUR
CUW|CW|531|Curaçao|SCA
ABW|AW|533|Aruba|SCA
SXM|SX|534|Sint Maarten|SCA
NCL|NC|540|New Caledonia|APAC
VUT|VU|548|Vanuatu|APAC
NZL|NZ|554|New Zealand|APAC
NIC|NI|558|Nicaragua|SCA
NER|NE|562|Niger|AFR
NGA|NG|566|Nigeria|AFR
NIU|NU|570|Niue|APAC
NFK|NF|574|Norfolk Island|APAC
NOR|NO|578|Norway|EUR
MNP|MP|580|Northern Mariana Islands|APAC
FSM|FM|583|Micronesia|APAC
MHL|MH|584|Marshall Islands|APAC
PLW|PW|585|Palau|APAC
PAK|PK|586|Pakistan|APAC
PAN|PA|591|Panama|SCA
PNG|PG|598|Papua New Guinea|APAC
PRY|PY|600|Paraguay|SCA
PER|PE|604|Peru|SCA
PHL|PH|608|Philippines|APAC
PCN|PN|612|Pitcairn Islands|APAC
POL|PL|616|Poland|EUR
PRT|PT|620|Portugal|EUR
GNB|GW|624|Guinea-Bissau|AFR
TLS|TL|626|Timor-Leste|APAC
PRI|PR|630|Puerto Rico|SCA
QAT|QA|634|Qatar|ME
ROU|RO|642|Romania|EUR
RUS|RU|643|Russia|CIS
RWA|RW|646|Rwanda|AFR
BLM|BL|652|Saint Barthélemy|SCA
SHN|SH|654|Saint Helena|AFR
KNA|KN|659|Saint Kitts and Nevis|SCA
AIA|AI|660|Anguilla|SCA
LCA|LC|662|Saint Lucia|SCA
MAF|MF|663|Saint Martin|SCA
SPM|PM|666|Saint Pierre and Miquelon|NAM
VCT|VC|670|Saint Vincent and the Grenadines|SCA
SMR|SM|674|San Marino|EUR
STP|ST|678|São Tomé and Príncipe|AFR
SAU|SA|682|Saudi Arabia|ME
SEN|SN|686|Senegal|AFR
SRB|RS|688|Serbia|EUR
SYC|SC|690|Seychelles|AFR
SLE|SL|694|Sierra Leone|AFR
SGP|SG|702|Singapore|APAC
SVK|SK|703|Slovakia|EUR
VNM|VN|704|Vietnam|APAC
SVN|SI|705|Slovenia|EUR
SOM|SO|706|Somalia|AFR
ZAF|ZA|710|South Africa|AFR
ZWE|ZW|716|Zimbabwe|AFR
ESP|ES|724|Spain|EUR
SSD|SS|728|South Sudan|AFR
SDN|SD|729|Sudan|AFR
ESH|EH|732|Western Sahara|AFR
SUR|SR|740|Suriname|SCA
SWZ|SZ|748|Eswatini|AFR
SWE|SE|752|Sweden|EUR
CHE|CH|756|Switzerland|EUR
SYR|SY|760|Syria|ME
TJK|TJ|762|Tajikistan|CIS
THA|TH|764|Thailand|APAC
TGO|TG|768|Togo|AFR
TON|TO|776|Tonga|APAC
TTO|TT|780|Trinidad and Tobago|SCA
ARE|AE|784|United Arab Emirates|ME
TUN|TN|788|Tunisia|AFR
TUR|TR|792|Türkiye|EUR
TKM|TM|795|Turkmenistan|CIS
TCA|TC|796|Turks and Caicos Islands|SCA
UGA|UG|800|Uganda|AFR
UKR|UA|804|Ukraine|EUR
MKD|MK|807|North Macedonia|EUR
EGY|EG|818|Egypt|AFR
GBR|GB|826|United Kingdom|EUR
GGY|GG|831|Guernsey|EUR
JEY|JE|832|Jersey|EUR
IMN|IM|833|Isle of Man|EUR
TZA|TZ|834|Tanzania|AFR
USA|US|840|United States|NAM
VIR|VI|850|U.S. Virgin Islands|SCA
BFA|BF|854|Burkina Faso|AFR
URY|UY|858|Uruguay|SCA
UZB|UZ|860|Uzbekistan|CIS
VEN|VE|862|Venezuela|SCA
WLF|WF|876|Wallis and Futuna|APAC
WSM|WS|882|Samoa|APAC
YEM|YE|887|Yemen|ME
ZMB|ZM|894|Zambia|AFR
XKX|XK||Kosovo|EUR
ATA|AQ|010|Antarctica|ANT
"""

REGION_NAMES = {
    "NAM": "North America",
    "SCA": "South & Central America",
    "EUR": "Europe",
    "CIS": "CIS",
    "ME": "Middle East",
    "AFR": "Africa",
    "APAC": "Asia Pacific",
    "ANT": "Antarctica & territories",
}

# EI "Total <region>" row label -> our region code
EI_REGION_ROWS = {
    "Total North America": "NAM",
    "Total S. & Cent. America": "SCA",
    "Total Europe": "EUR",
    "Total CIS": "CIS",
    "Total Middle East": "ME",
    "Total Africa": "AFR",
    "Total Asia Pacific": "APAC",
    "Total World": "WORLD",
}


class Country(dict):
    """Plain dict subclass for readability: iso3, iso2, num, name, region."""


COUNTRIES: dict[str, Country] = {}
for _line in _TABLE.strip().splitlines():
    _iso3, _iso2, _num, _name, _region = _line.split("|")
    COUNTRIES[_iso3] = Country(iso3=_iso3, iso2=_iso2, num=_num or None, name=_name, region=_region)

NUM_TO_ISO3 = {c["num"]: iso for iso, c in COUNTRIES.items() if c["num"]}

# Natural Earth (world-atlas) features that carry no ISO numeric id.
NATURAL_EARTH_UNCODED = {
    "Kosovo": "XKX",
    "N. Cyprus": "CYP",
    "Somaliland": "SOM",
    "Indian Ocean Ter.": "AUS",
    "Siachen Glacier": None,
}

# Every spelling the Energy Institute workbook uses for a single country.
EI_NAMES = {
    "Algeria": "DZA", "Angola": "AGO", "Argentina": "ARG", "Australia": "AUS", "Austria": "AUT",
    "Azerbaijan": "AZE", "Bahrain": "BHR", "Bangladesh": "BGD", "Belarus": "BLR", "Belgium": "BEL",
    "Bolivia": "BOL", "Brazil": "BRA", "Brunei": "BRN", "Bulgaria": "BGR", "Canada": "CAN",
    "Chad": "TCD", "Chile": "CHL", "China": "CHN", "China Hong Kong SAR": "HKG", "Colombia": "COL",
    "Croatia": "HRV", "Curacao": "CUW", "Cyprus": "CYP", "Czech Republic": "CZE", "Denmark": "DNK",
    "Ecuador": "ECU", "Egypt": "EGY", "Equatorial Guinea": "GNQ", "Estonia": "EST", "Finland": "FIN",
    "France": "FRA", "Gabon": "GAB", "Germany": "DEU", "Greece": "GRC", "Guyana": "GUY",
    "Honduras": "HND", "Hungary": "HUN", "Iceland": "ISL", "India": "IND", "Indonesia": "IDN",
    "Iran": "IRN", "Iraq": "IRQ", "Ireland": "IRL", "Israel": "ISR", "Italy": "ITA", "Japan": "JPN",
    "Jordan": "JOR", "Kazakhstan": "KAZ", "Kuwait": "KWT", "Latvia": "LVA", "Libya": "LBY",
    "Lithuania": "LTU", "Luxembourg": "LUX", "Malaysia": "MYS", "Mexico": "MEX", "Mongolia": "MNG",
    "Morocco": "MAR", "Myanmar": "MMR", "Netherlands": "NLD", "New Zealand": "NZL", "Nigeria": "NGA",
    "North Macedonia": "MKD", "Norway": "NOR", "Oman": "OMN", "Pakistan": "PAK",
    "Papua New Guinea": "PNG", "Peru": "PER", "Philippines": "PHL", "Poland": "POL", "Portugal": "PRT",
    "Qatar": "QAT", "Republic of Congo": "COG", "Romania": "ROU", "Russia": "RUS",
    "Russian Federation": "RUS", "Saudi Arabia": "SAU", "Serbia": "SRB", "Singapore": "SGP",
    "Slovakia": "SVK", "Slovenia": "SVN", "South Africa": "ZAF", "South Korea": "KOR",
    "South Sudan": "SSD", "Spain": "ESP", "Sri Lanka": "LKA", "Sudan": "SDN", "Sweden": "SWE",
    "Switzerland": "CHE", "Syria": "SYR", "Taiwan": "TWN", "Thailand": "THA",
    "The Dominican Republic": "DOM", "Trinidad & Tobago": "TTO", "Tunisia": "TUN", "Turkey": "TUR",
    "Türkiye": "TUR", "Turkmenistan": "TKM", "US": "USA", "Ukraine": "UKR",
    "United Arab Emirates": "ARE", "United Kingdom": "GBR", "Uzbekistan": "UZB",
    "Venezuela": "VEN", "Viet Nam": "VNM", "Vietnam": "VNM", "Yemen": "YEM", "Zimbabwe": "ZWE",
}

# UN Comtrade partner ISO codes that are not ISO3 country codes.
COMTRADE_ISO_FIX = {
    "S19": "TWN",  # "Other Asia, nes" — Comtrade's label for Taiwan
    "SCG": None,  # Serbia and Montenegro (historical)
}

# Extra search aliases (lower-case) for the command palette.
ALIASES = {
    "USA": ["us", "usa", "america", "united states of america", "states"],
    "GBR": ["uk", "britain", "great britain", "england"],
    "ARE": ["uae", "emirates", "abu dhabi", "dubai"],
    "KOR": ["korea", "republic of korea", "rok"],
    "PRK": ["dprk"],
    "RUS": ["russian federation"],
    "IRN": ["persia", "islamic republic of iran"],
    "CZE": ["czech republic"],
    "TUR": ["turkey", "turkiye"],
    "CIV": ["ivory coast", "cote d'ivoire"],
    "COD": ["drc", "congo-kinshasa", "democratic republic of the congo"],
    "COG": ["congo-brazzaville", "congo"],
    "NLD": ["holland"],
    "MKD": ["macedonia"],
    "SWZ": ["swaziland"],
    "MMR": ["burma"],
    "TWN": ["chinese taipei"],
    "VNM": ["viet nam"],
    "LAO": ["lao pdr"],
    "SAU": ["ksa"],
    "BIH": ["bosnia"],
    "TTO": ["trinidad"],
}


def iso3_for_ei(name: str) -> str | None:
    return EI_NAMES.get(name.strip())


def region_of(iso3: str) -> str | None:
    c = COUNTRIES.get(iso3)
    return c["region"] if c else None


def flag_emoji(iso3: str) -> str:
    c = COUNTRIES.get(iso3)
    if not c or not c["iso2"] or len(c["iso2"]) != 2:
        return ""
    return "".join(chr(0x1F1E6 + ord(ch) - ord("A")) for ch in c["iso2"].upper())
