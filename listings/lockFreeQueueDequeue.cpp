value_type * dequeue() {
	
	node_type * pNext;
	node_type * h;
	
	while (true) {
		h = m_pHead;
		pNext = h->m_pNext;
		
		// someone has changed the relationship between the head and the next node
		if (m_pHead.load() != h)
			continue;
		
		//queue is empty, head is always dummy node
		if (pNext == nullptr)
			return nullptr;
		
		//tail was not pushed forward, trying to promote
		node_type * t = m_pTail.load();
		if (h == t) {
			m_pTail.compare_exchange_strong(t, pNext);
			continue;
		}
		
		//push forward head
		if (m_pHead.compare_exchange_strong(h, pNext))
			break;
	}
	
	return pNext;
}