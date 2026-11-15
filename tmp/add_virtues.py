import re

with open("/tmp/build_full_lexicon.py", "r", encoding="utf-8") as f:
    code = f.read()

extra_concepts = '''
    ("goodness", "Virtues",
     {"en": ("Goodness / Blessing", "/ˈɡʊd.nəs/", "noun", "Moral virtue, benevolence, and blessed favour."),
      "ha": ("Alheri", "/àl.héː.rìː/", "noun (masc.)", "أَلْخَيْرِي (Ajami)", "Nagarta, kyauta, tagomashi, da abin alfahari."),
      "yo": ("Oore / Ìwà rere", "/ōː.ɾē/", "noun", "Ìwà rere, ìṣoore, àti àbùkún sí ẹlòmíràn."),
      "ff": ("Moƴƴere / Barké", "/mod͡ʒ.d͡ʒe.re/", "noun (class nde)", "𞤃𞤮𞤰𞥆𞤫𞤪𞤫 (Adlam)", "Moƴƴere ko jikku lobbo e gollal barkinaangal."),
      "ar": ("خَيْر", "/xajr/", "noun / adj", "خ - ي - ر", "كل ما يرغب فيه الإنسان من الفضل والبر والصلاح."),
      "fr": ("Bonté / Bienveillance", "/bɔ̃.te/", "noun (fém.)", "Qualité morale d’une personne bienfaisante et généreuse."),
      "zh": ("善 / 善良", "/ʂân/", "noun", "shàn", "善 / 善良", "高尚的心地与利他道德品质。")}),

    ("wisdom", "Philosophy",
     {"en": ("Wisdom", "/ˈwɪz.dəm/", "noun", "The quality of having experience, knowledge, and good judgment."),
      "ha": ("Hikima", "/hì.kí.màː/", "noun (fem.)", "حِكِمَا (Ajami)", "Basira da basirar aiki da ilimi wajen yanke hukunci."),
      "yo": ("Ọgbọ́n", "/ɔ̄.ɡ͡bɔ̃́/", "noun", "Òye àti làákàyè jíjinlẹ̀ láti mọ bí a ṣe ń gbé ayé."),
      "ff": ("Hakkillo / Yoyre", "/hak.kil.lo/", "noun (class ngo)", "𞤖𞤢𞤳𞥆𞤭𞤤𞥆𞤮 (Adlam)", "Hakkillo ko faamu cemmbiɗɗo e jikku lobbo."),
      "ar": ("حِكْمَة", "/ˈħik.ma/", "noun (fem.)", "ح - ك - م", "وضع الشيء في موضعه بحسن تدبير ورزانة رأي."),
      "fr": ("Sagesse", "/sa.ʒɛs/", "noun (fém.)", "Connaissance des choses justes avec une conduite mesurée."),
      "zh": ("智慧", "/ʈʂʐ̩̂.xwêɪ/", "noun", "zhì huì", "智慧", "对事物明辨是非并做出合理决断的能力。")}),

    ("patience", "Virtues",
     {"en": ("Patience / Fortitude", "/ˈpeɪ.ʃəns/", "noun", "The capacity to tolerate delay, difficulty, or suffering with calm."),
      "ha": ("Hakuri / Ƙarfin hali", "/hà.kù.ríː/", "noun (masc.)", "حَكُرِي (Ajami)", "Juriya da natsuwa wajen jure wuya ba tare da fushi ba."),
      "yo": ("Ìfaradà / Sùúrù", "/ì.fa.ɾa.dà/", "noun", "Agbára láti mú sùúrù nígbà ìpọ́njú láìsí ìkùnsínú."),
      "ff": ("Munyal", "/mun.jal/", "noun (class ngal)", "𞤃𞤵𞤲𞤴𞤢𞤤 (Adlam)", "Munyal ko jikku cemmbiɗɗo ngam muɲnde bone e baasal."),
      "ar": ("صَبْر", "/sˤabr/", "noun (masc.)", "ص - ب - ر", "حبس النفس عن الجزع والشكوى عند نزول الشدائد."),
      "fr": ("Patience / Persévérance", "/pa.sjɑ̃s/", "noun (fém.)", "Capacité à supporter les épreuves avec calme."),
      "zh": ("耐心 / 坚忍", "/nâɪ.ɕín/", "noun", "nài xīn", "耐心 / 堅忍", "面对困顿能从容自持不躁不馁的品格。")}),

    ("knowledge", "Education",
     {"en": ("Knowledge", "/ˈnɒl.ɪd͡ʒ/", "noun", "Information, skills, and understanding acquired through education."),
      "ha": ("Ilimi", "/ì.lí.míː/", "noun (masc.)", "عِلِمِي (Ajami)", "Sanin gaskiyar al’amari da fahimtar abubuwa ta hanyar karatu."),
      "yo": ("Ìmọ̀", "/ì.mɔ̀/", "noun", "Òye, ìmọ̀lára, àti ẹ̀kọ́ tí ènìyàn kọ́ nípa ayé."),
      "ff": ("Gandal", "/gan.dal/", "noun (class ngal)", "𞤘𞤢𞤲𞤣𞤢𞤤 (Adlam)", "Gandal ko kumpa timmuka e faamu ngal heɓatee e janngude."),
      "ar": ("عِلْم", "/ʕilm/", "noun (masc.)", "ع - ل - م", "إدراك الشيء على حقيقته والمعرفة التي تنير العقل."),
      "fr": ("Savoir / Connaissance", "/sa.vwaʁ/", "noun (masc.)", "Ensemble des connaissances théoriques et pratiques."),
      "zh": ("知识 / 学问", "/ʈʂʐ̩̄.ʂʐ̩/", "noun", "zhī shi", "知識 / 學問", "人类在实践中所获得的认识和经验总和。")}),
'''

marker = '("peace", "Virtues",'
if '("goodness"' not in code:
    code = code.replace(marker, extra_concepts + '\n    ' + marker)
    with open("/tmp/build_full_lexicon.py", "w", encoding="utf-8") as f:
        f.write(code)
    print("Added virtues successfully")
