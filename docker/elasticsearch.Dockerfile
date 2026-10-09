# Elasticsearch + ICU 分詞。
# standard analyzer 會把中文逐字切；smartcn 只認得簡體，繁體一樣逐字切（實測）。
# icu_tokenizer 用字典斷詞，繁簡都能切成詞，再用 icu_transform 繁轉簡，簡體查詢也找得到繁體內容。
FROM docker.elastic.co/elasticsearch/elasticsearch:9.5.5
RUN bin/elasticsearch-plugin install --batch analysis-icu
